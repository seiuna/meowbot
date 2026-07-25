import { HumanMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { SessionContext, SessionType } from "@meowbot/gateway/index.types";
import { modelRegistry } from "@meowbot/llm";
import { ModelRegistry } from "@meowbot/llm/provider_registry";
import { toolRegistry, ToolRegistry } from "@meowbot/tools/tool_registry";
import { getLogger } from "@meowbot/utils/logs";
import { Prompts } from "@meowbot/template/prompts";
import { getPromptContext } from "@meowbot/template/prompt_context.js";
import type { CompiledStateGraph } from "@langchain/langgraph";
import { AsyncKeyedMutex } from "../utils/async-mutex.js";
import { clearThread as clearThreadState } from "./thread_manager.js";

export abstract class BaseAgent {
    public readonly name: string;
    public readonly description: string;
    protected readonly logger;
    protected readonly models: ModelRegistry = modelRegistry;
    protected readonly toolsRegistry: ToolRegistry = toolRegistry;
    protected readonly requiredModels: string[] = [];

    /**
     * Tool providers this agent needs.
     * - Empty array or undefined = ALL registered tools
     * - Provider names = only tools from those providers
     */
    protected readonly requiredToolProviders: string[];

    /** Mutex to ensure sequential execution per threadId (sessionId + agentId). */
    private readonly threadMutex = new AsyncKeyedMutex();

    constructor(name: string, description: string, requiredToolProviders?: string[]) {
        this.name = name;
        this.description = description;
        this.requiredToolProviders = requiredToolProviders ?? [];
        this.logger = getLogger("Agent: " + this.name);
    }

    /**
     * Execute session with thread-level serialization.
     * Uses AsyncKeyedMutex to guarantee only one execution per threadId at a time.
     */
    public async execute(session: SessionContext<SessionType>): Promise<void> {
        session.updateThreadId(this.name);
        const threadId = session.threadId;

        await this.threadMutex.acquire(threadId, async () => {
            try {
                await this.beforeHandle(session);
                await this.handleSession(session);
                await this.afterHandle(session);
            } catch (error) {
                await this.handleError(session, error);
            }
        });
    }


    protected abstract handleSession(session: SessionContext<SessionType>): Promise<void>;

    /** The compiled LangGraph state graph for this agent. */
    abstract getGraph(): CompiledStateGraph<any, any, any>;

    /**
     * Clear the conversation history for a thread.
     * Waits for any running execution on this thread to finish, then wipes the state.
     */
    async clearThread(threadId: string): Promise<void> {
        // Wait for mutex to release before clearing
        if (this.threadMutex.isLocked(threadId)) {
            this.logger.info("[clearThread] Waiting for running execution on " + threadId);
            await this.threadMutex.acquire(threadId, async () => {});
        }

        // Delegate to thread_manager which uses LangGraph updateState
        await clearThreadState(this.getGraph(), threadId);
    }

    protected async beforeHandle(session: SessionContext<SessionType>): Promise<void> {
        session.tracker.push("beforeHandle", { agent: this.name });
        await modelRegistry.ensureModelsAvailable(this.requiredModels);
    }


    protected async afterHandle(session: SessionContext<SessionType>): Promise<void> {
        session.tracker.push("afterHandle", { agent: this.name });
    }

    protected async handleError(session: SessionContext<SessionType>, error: unknown): Promise<void> {
        session.tracker.push("handleError", { agent: this.name, error });
        this.logger.error(error);
    }

    protected async buildIncomeMessage(session: SessionContext<SessionType>): Promise<HumanMessage> {
        const event = session.event;
        const msg = session.event.message;

        // Pre-process event data for the ${} template
        const time = new Date(event.timestamp).toISOString();
        let refText = "[No quote]";
        if ((event as any).reference?.MessageEvent) {
            const refMsg = (event as any).reference.MessageEvent;
            refText = `${refMsg.messageId} ${refMsg.message || "[No content]"}`;
        }

        // Merge session context with global context
        const templateData: Record<string, any> = {
            ...getPromptContext({
                userId: event.userId,
                publicId: event.publicId || "[Not in a group]",
                username: event.username,
                message: msg,
                adapter: event.adapter,
            }),
            ...event,
            time,
            refText: refText.length > 100 ? refText.slice(0, 100) + "..." : refText,
            refId: (event as any).reference?.MessageEvent?.messageId || "[No ID]",
            message: msg,
        };

        const adapter = event.adapter;
        // Try adapter-specific template first, then generic "message"
        let content = await Prompts.build(`${adapter}-message`, templateData);
        if (!content) {
            content = await Prompts.build("message", templateData);
        }
        if (!content) {
            this.logger.warn(`Template "${adapter}-message" not found, using raw message`);
            return new HumanMessage({ content: msg });
        }
        return new HumanMessage({ content });
    }

    /**
     * Get tools available to this agent, filtered by requiredToolProviders.
     * If requiredToolProviders is empty, returns ALL registered tools.
     */
    protected getTools(): DynamicStructuredTool[] {
        if (this.requiredToolProviders.length === 0) {
            return this.toolsRegistry.getAllTools();
        }
        return this.toolsRegistry.getToolsForProviders(this.requiredToolProviders);
    }

    /**
     * Get the number of active threads for this agent
     */
    public getActiveThreadCount(): number {
        return this.threadMutex.size;
    }

    /**
     * Check if a specific thread is active
     */
    public isThreadActive(threadId: string): boolean {
        return this.threadMutex.isLocked(threadId);
    }
}
