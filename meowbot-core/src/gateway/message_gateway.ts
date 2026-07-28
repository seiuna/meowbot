import { createHash, randomUUID } from "node:crypto";
import { BaseAdapter, MessageData, MessageEvent } from "./adapters/types";
import { Middleware, ResolveEvent, SessionContext, SessionContextImp, SessionType } from "./index.types";
import { getLogger } from "@meowbot/utils/logs";
import { AgentDispatcherMiddleware } from "@meowbot/agent/agent_middleware";
import { CommandDispatcherMiddleware } from "@meowbot/command/middleware";
import { QQAdapter } from "./adapters/qq";
import { getFileService } from "../files/index.js";

const logger = getLogger("MessageGateway");

/**
 * Message gateway class
 * Serves as the core hub for message processing, responsible for:
 * 1. Registering and managing platform adapters
 * 2. Receiving messages from adapters and computing unique identifiers
 * 3. Building session context (SessionContext)
 * 4. Executing the middleware pipeline for message processing
 */
export class MessageGateway {
    /** Registered adapters map, keyed by adapter name */
    private adapters: Map<string, BaseAdapter> = new Map();
    /** Middleware list, executed in registration order */
    private middlewares: Middleware<SessionContext<SessionType>>[] = [];

    /**
     * Register a middleware
     * Middlewares execute in registration order and can intercept, transform, or enhance messages
     * @param middleware Middleware function receiving context and next parameters
     */
    public use(middleware: Middleware<SessionContext<SessionType>>): void {
        this.middlewares.push(middleware);
    }

    /**
     * Register an adapter
     * Adds the adapter to the gateway and auto-injects the gateway instance
     * @param adapter Adapter instance to register
     * @throws Error if an adapter with the same name already exists
     */
    public registerAdapter(adapter: BaseAdapter): void {
        const meta = adapter.getMeta();
        if (this.adapters.has(meta.name)) {
            throw new Error(`Adapter with name ${meta.name} is already registered.`);
        }
        // Inject gateway instance into adapter
        adapter.setGateway(this);
        this.adapters.set(meta.name, adapter);
    }

    public connectAdapter(adapterName: string): void {
        const adapter = this.adapters.get(adapterName);
        if (!adapter) {
            throw new Error(`Adapter ${adapterName} is not registered.`);
        }
        adapter.connect().catch((err) => {
            logger.error(`Failed to connect adapter ${adapterName}:`, err);
        });
    }

    public disconnectAdapter(adapterName: string): void {
        const adapter = this.adapters.get(adapterName);
        if (!adapter) {
            throw new Error(`Adapter ${adapterName} is not registered.`);
        }
        adapter.disconnect().catch((err) => {
            logger.error(`Failed to disconnect adapter ${adapterName}:`, err);
        });
    }

    public async connectAllAdapters(): Promise<void> {
        const connectPromises: Promise<void>[] = [];
        for (const adapter of this.adapters.values()) {
            connectPromises.push(adapter.connect().catch((err) => {
                logger.error(`Failed to connect adapter ${adapter.getMeta().name}:`, err);
            }));
        }
        await Promise.all(connectPromises);
    }

    public disconnectAllAdapters(): void {
        for (const adapter of this.adapters.values()) {
            adapter.disconnect().catch((err) => {
                logger.error(`Failed to disconnect adapter ${adapter.getMeta().name}:`, err);
            })
        }
    }

    public getAdapter(adapterName: string): BaseAdapter | undefined {
        return this.adapters.get(adapterName);
    }

    /**
     * Send a notification to a specific user/channel via an adapter.
     * Emits the 'notify' event on the target adapter so it can deliver the message.
     */
    public notify(adapterName: string, publicId: string, userId: string, messages: MessageData): void {
        const adapter = this.adapters.get(adapterName);
        if (!adapter) {
            logger.warn("[Gateway] notify failed: adapter " + adapterName + " not found");
            return;
        }
        adapter.emit("notify", { publicId, userId, messages });
        logger.info("[Gateway] notify -> " + adapterName + " publicId=" + publicId);
    }

    /**
     * Process a message
     * Entry point for messages entering the gateway, performs the following steps:
     * 1. Compute message unique identifier (uniqueId)
     * 2. Compute session ID (sessionId) and trace ID (traceId)
     * 3. Build session context (SessionContext)
     * 4. Execute the middleware pipeline
     * @param message Message event object
     * @param sessionType Session type that determines the event type in SessionContext
     */
    public async process<T extends SessionType>(message: MessageEvent, sessionType: T): Promise<void> {
        // Compute and set message unique identifier
        const uniqueId = this.calculateUniqueId(message);
        message.uniqueId = uniqueId;

        // Build session context
        const context: SessionContext<T> = new SessionContextImp<T>(this, message as ResolveEvent<T>, sessionType);

        // Auto-register adapter files (images + files) with FileService
        // so they can be retrieved later by fileId from LLM tools.
        if (message.extraPayload) {
            const fileService = getFileService();
            const allFiles = [
                ...(message.extraPayload.images ?? []),
                ...(message.extraPayload.files ?? []),
            ];
            if (allFiles.length > 0) {
                fileService.registerAll(allFiles);
            }
        }

        await this.executePipeline(context);
    }

    /**
     * Execute the middleware pipeline
     * Executes middlewares in registration order, each middleware can:
     * - Continue to the next middleware (by calling next)
     * - Abort the pipeline (by not calling next)
     * @param context Session context
     */
    private async executePipeline(context: SessionContext<SessionType>): Promise<void> {
        let index = -1;

        /**
         * Recursive dispatch function
         * @param i Index of the middleware to execute
         */
        const dispatch = async (i: number): Promise<void> => {
            if (i <= index) {
                return;
            }
            index = i;

            const middleware = this.middlewares[i];
            if (!middleware) return;

            try {
                await middleware(context, dispatch.bind(null, i + 1));
            } catch (error) {
                logger.error(`Middleware ${i} failed:`, error);
                throw error;
            }
        };

        // Start from the first middleware
        await dispatch(0);
    }

    /**
     * Calculate trace ID
     * Generates a globally unique trace identifier using UUID v4
     * @param message Message event
     * @returns UUID-formatted trace ID
     */
    public calculateTraceId(message: MessageEvent): string {
        return randomUUID();
    }

    /**
     * Calculate session ID
     * Format is "Session_{uniqueId}", used to identify a complete session
     * @param message Message event
     * @returns Session ID string
     */
    public calculateSessionId(message: MessageEvent): string {
        const uniqueId = this.calculateUniqueId(message);
        return `Session_${uniqueId}`;
    }

    /**
     * Calculate message unique identifier
     * - If uniqueId is already a string, returns it directly
     * - If it's an object, merges with adapter and userId, then computes SHA-256 hash
     * @param message Message event
     * @returns SHA-256 hash string as unique identifier
     */
    public calculateUniqueId(message: MessageEvent): string {
        // Return directly if already a string
        if (typeof message.uniqueId === "string") {
            return message.uniqueId;
        }

        // Merge parameters and compute SHA-256 hash
        const payload = {

            ...message.uniqueId,
        };

        const hash = createHash("sha256")
            .update(JSON.stringify(payload))
            .digest("hex");

        return hash;
    }
}

export const messageGateway = new MessageGateway();

export const LoggerMiddleware: Middleware<SessionContext<SessionType>> = async (ctx, next) => {
    const imageCount = ctx.event.extraPayload?.images?.length ?? 0;
    const soundCount = ctx.event.extraPayload?.sounds?.length ?? 0;
    logger.info(`Received ${ctx.sessionType} from ${ctx.event.adapter}: ${ctx.event.message} images: ${imageCount}, sounds: ${soundCount}`);
    await next();
};

export const SessionResolverMiddleware: Middleware<SessionContext<SessionType>> = async (ctx, next) => {
    // Apply user's selected session and agent before any command or agent processing
    try {
        const { getUserProfileManager } = await import("@meowbot/social/user_profile_manager.js");
        const profileManager = getUserProfileManager();
        const userId = ctx.event.userId;
        const profile = await profileManager.getUserProfile(userId);

        if (profile) {
            const selectedAgent = profile.agent || "default";
            const selectedSession = profile.selectedSession || ctx.sessionId;

            // Update context with user's selections
            if ('updateSession' in ctx && typeof ctx.updateSession === 'function') {
                ctx.updateSession(selectedSession, selectedAgent);
            } else {
                ctx.route.agentId = selectedAgent;
            }

            logger.debug(`Applied user selections - session: ${selectedSession}, agent: ${selectedAgent}`);
        }
    } catch (error) {
        logger.warn(`Failed to resolve session: ${error}`);
    }

    await next();
};

export async function bootstrapMessageGateway() {
    messageGateway.use(SessionResolverMiddleware);  // Add before command/agent processing
    messageGateway.use(LoggerMiddleware);
    messageGateway.use(CommandDispatcherMiddleware);
    messageGateway.use(AgentDispatcherMiddleware);
    
    messageGateway.registerAdapter(new QQAdapter());
    
    await messageGateway.connectAllAdapters(); 
}
