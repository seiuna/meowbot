import { MessageGateway } from "./message_gateway";
import { BaseAdapter, CommandEvent, MessageData, MessageEvent, HandleSource } from "./adapters/types";
import { Holder } from "@meowbot/utils/holder";
import { randomUUID } from "crypto";
import { IUserProfile } from "@meowbot/database/models";
import { HITLRequest, HITLResponse, HITLWaitResult, attachResult, SelectRequest, ConfirmRequest, TextRequest } from "./hitl.js";
import { getUserProfileManager } from "@meowbot/social/user_profile_manager.js";

// Re-export HITL types
export type { HITLRequest, HITLResponse } from "./hitl.js";
export {
    createSelectRequest,
    createMultiSelectRequest,
    createConfirmRequest,
    createTextRequest,
    isSelectResponse,
    isConfirmResponse,
    isTextResponse,
    isRejectResponse,
    isTimeoutResponse,
} from "./hitl.js";

/**
 * Next function type
 * Calling this function executes the next middleware in the pipeline
 */
export type NextFunction = () => Promise<void>;

/**
 * Middleware function type
 * @template C Context type
 * @param context Session context object
 * @param next Function to call the next middleware
 */
export type Middleware<C> = (
    context: C,
    next: NextFunction
) => Promise<void> | void;

/**
 * Session type literal union
 * - "message": Regular message session
 * - "command": Command message session
 */
export type SessionType = "message" | "command";

/**
 * Resolve event type based on session type
 * Conditional type utility:
 * - When T is "command", returns CommandEvent
 * - When T is "message", returns MessageEvent
 * @template T Session type
 */
export type ResolveEvent<T extends SessionType> = T extends "command"
    ? CommandEvent
    : MessageEvent;

/**
 * Session context interface
 * Encapsulates all information needed during a message processing lifecycle
 * The generic T controls the concrete type of the event field
 * @template T Session type, defaults to "message"
 */
export interface SessionContext<T extends SessionType = "message"> {
    /**
     * Session unique identifier
     * Format is "Session_{uniqueId}", used to track the same session across multiple messages
     * Messages from the same user on the same adapter share the same sessionId
     */
    sessionId: string;

    /**
     * Thread identifier = sessionId + agentId
     * Used for Agent-level serialization and HITL
     */
    threadId: string;

    tracker: MessageTracker;

    /**
     * Session type
     * Determines how the event should be processed and the concrete type of the event field
     */
    sessionType: T;

    /**
     * Event object that triggered the session
     * Depending on sessionType, can be MessageEvent or CommandEvent
     */
    event: ResolveEvent<T>;

    /**
     * Current message gateway instance
     * Can be used in middlewares to access other gateway features
     */
    gateway: MessageGateway;

    /**
     * Route information
     * Used to specify which Agent should handle this event
     * Defaults to "default-agent" if not provided
     */
    route: {

        /** Agent ID responsible for handling this event */
        agentId: "default-agent" | string;

        /**
         * @default 5
         * Max redirect depth to prevent infinite loops in message routing.‘
         * If this value to 0, it will throw an error to prevent infinite loops.
         */
        ttl: number;

        /**
         * Path of the message in Agent redirect chain, used for debugging and tracing message flow.
         * If the length of the path exceeds default value of ${ttl}, it will make a error to prevent infinite loops.
         * Each Agent that redirects the message should append its own identifier to this path.
         */
        path: string[];
    }

    /** Whether the session is waiting for external resolve (HITL) */
    isWaiting: boolean;

    /**
     * Source of the message emission.
     * Set automatically based on sessionType ("command" → "Command", else "Agent").
     * Tools can override to "Tools", sub-agents to "SubAgent".
     */
    handleSource: HandleSource;

    getAdapter: () => BaseAdapter;

    exception(error: Error): void;

    message(message: MessageData | string): void;

    getUserProfile(): Promise<IUserProfile>;

    /**
     * Update threadId when agentId changes
     * @param agentId - The agent ID to set
     */
    updateThreadId(agentId: string): void;

    /**
     * Wait for user interaction (HITL - Human In The Loop)
     * @param request - The HITL request (select, confirm, text)
     * @returns Promise that resolves with the user's response, narrowed by request type
     */
    wait<T extends HITLRequest>(request: T): Promise<HITLWaitResult<T>>;

    /**
     * Resolve a waiting session (HITL)
     * @param response - The HITL response
     */
    resolve(response: HITLResponse): void;

    /**
     * Reject a waiting session (HITL)
     * @param reason - The reason for rejection
     */
    reject(reason: string): void;

    /**
     * Check if the current user has explicit permission for a resource.
     * Uses requireAllowed (explicit allow) — the user must actively possess the permission.
     *
     * @param perm - Permission resource path (e.g. "admin.permission", "user.createtask")
     * @returns null if allowed, or a Chinese error message string if denied
     *
     * Usage:
     *   const denied = await ctx.require("admin.permission");
     *   if (denied) return denied;
     */
    require(perm: string): Promise<string | null>;
}

export class SessionContextImp<T extends SessionType = "message"> implements SessionContext<T> {
    public readonly sessionId: string;
    public readonly threadId: string;
    public readonly tracker: MessageTracker;
    public readonly sessionType: T;
    public readonly route = { ttl: 5, path: [] as string[], agentId: "default-agent" };
    
    /** HITL state */
    public isWaiting: boolean = false;
    /** Source of message emission — set automatically, can be overridden by tools/sub-agents */
    public handleSource: HandleSource;
    private currentRequest: HITLRequest | null = null;
    private resolvePromise: ((response: HITLResponse) => void) | null = null;
    private rejectPromise: ((reason: any) => void) | null = null;
    private waitTimeout: NodeJS.Timeout | null = null;

    constructor(
        public readonly gateway: MessageGateway,
        public readonly event: ResolveEvent<T>,
        sessionType: T
    ) {
        this.event = event;
        this.sessionId = this.gateway.calculateSessionId(this.event);
        this.threadId = `${this.sessionId}:${this.route.agentId}`;
        this.tracker = new MessageTracker(this);
        this.sessionType = sessionType;
        this.handleSource = sessionType === "command" ? "Command" : "Agent";
    }

    /**
     * Get user profile for the current user
     */
    public async getUserProfile(): Promise<IUserProfile> {
        const manager = getUserProfileManager();
        const userId = this.event.userId;
        const profile = await manager.getUserProfile(userId);
        
        if (!profile) {
            // Create a new profile if not exists
            return await manager.getOrCreateProfile(userId);
        }
        
        return profile;
    }

    /**
     * Update sessionId and threadId
     * Used by middleware to apply user's selected session
     */
    public updateSession(sessionId: string, agentId: string): void {
        (this.sessionId as string) = sessionId;
        (this.threadId as string) = `${sessionId}:${agentId}`;
        this.route.agentId = agentId;
    }

    /**
     * Update threadId when agentId changes
     */
    public updateThreadId(agentId: string): void {
        (this.threadId as string) = `${this.sessionId}:${agentId}`;
    }

    public getAdapter(): BaseAdapter {
        const adapter = this.gateway.getAdapter(this.event.adapter);
        return adapter as BaseAdapter;
    }

    public exception(error: Error) {
        const adapter = this.getAdapter();
        if (adapter) {
            adapter.emit("exception", this, error);
        }
    }

    public message(msg: MessageData | string) {
        const adapter = this.getAdapter();
        if (adapter) {
            adapter.emit("message", this.handleSource, this, typeof msg === "string" ? [{ type: "text", data: msg }] : msg);
        }
    }

    /**
     * Wait for user interaction (HITL)
     * @param request - The HITL request
     * @returns Promise that resolves with the user's response, narrowed by request type
     */
    public wait<T extends HITLRequest>(request: T): Promise<HITLWaitResult<T>> {
        if (this.isWaiting) {
            return Promise.reject(new Error("Session is already waiting for HITL response"));
        }

        this.isWaiting = true;
        this.currentRequest = request;

        // Get timeout from request or default
        const timeoutMs = request.timeoutMs ?? 30000;

        // Register this session as waiting in the adapter
        const adapter = this.getAdapter();
        adapter.registerWaitingSession(this);

        // Send the request to the user
        this.sendHITLRequest(request);

        return new Promise<HITLWaitResult<T>>((resolve, reject) => {
            this.resolvePromise = ((raw: HITLResponse) => {
                resolve(attachResult(raw, request));
            }) as (response: HITLResponse) => void;
            this.rejectPromise = reject;

            // Set timeout
            this.waitTimeout = setTimeout(() => {
                this.isWaiting = false;
                this.currentRequest = null;
                this.resolvePromise = null;
                this.rejectPromise = null;
                this.waitTimeout = null;
                // Unregister from adapter
                adapter.unregisterWaitingSession(this.sessionId);
                resolve(attachResult({ type: "timeout" }, request));
            }, timeoutMs);
        });
    }

    /**
     * Send HITL request to the user via adapter
     */
    private sendHITLRequest(request: HITLRequest): void {
        const adapter = this.getAdapter();
        if (!adapter) return;

        let messageContent: string;

        switch (request.type) {
            case "select":
                messageContent = this.formatSelectRequest(request);
                break;
            case "confirm":
                messageContent = this.formatConfirmRequest(request);
                break;
            case "text":
                messageContent = this.formatTextRequest(request);
                break;
            default:
                messageContent = "未知请求类型";
        }

        adapter.emit("message", this.handleSource, this, [{ type: "text", data: messageContent }]);
    }

    /**
     * Format select request for display
     */
    private formatSelectRequest(request: SelectRequest): string {
        let content = `${request.prompt}\n\n`;
        
        request.options.forEach((option, index) => {
            content += `${index + 1}. ${option.label}`;
            if (option.description) {
                content += ` - ${option.description}`;
            }
            content += "\n";
        });

        if (request.allowCustom) {
            content += `${request.options.length + 1}. ${request.customLabel ?? "其他"}\n`;
        }

        if (request.multiple) {
            content += "\n（可多选，用逗号分隔选项编号）";
        }

        return content;
    }

    /**
     * Format confirm request for display
     */
    private formatConfirmRequest(request: ConfirmRequest): string {
        let content = `${request.prompt}\n\n`;
        content += `1. ${request.confirmLabel ?? "确认"}\n`;
        content += `2. ${request.cancelLabel ?? "取消"}\n`;
        return content;
    }

    /**
     * Format text request for display
     */
    private formatTextRequest(request: TextRequest): string {
        let content = `${request.prompt}`;
        if (request.placeholder) {
            content += `\n\n${request.placeholder}`;
        }
        return content;
    }

    /**
     * Resolve a waiting session (HITL)
     */
    public resolve(response: HITLResponse): void {
        if (!this.isWaiting || !this.resolvePromise) {
            return;
        }

        // Clear timeout
        if (this.waitTimeout) {
            clearTimeout(this.waitTimeout);
            this.waitTimeout = null;
        }

        this.isWaiting = false;
        this.currentRequest = null;
        
        // Unregister from adapter
        const adapter = this.getAdapter();
        adapter.unregisterWaitingSession(this.sessionId);
        
        this.resolvePromise(response);
        this.resolvePromise = null;
        this.rejectPromise = null;
    }

    /**
     * Reject a waiting session (HITL)
     */
    public reject(reason: string): void {
        if (!this.isWaiting || !this.rejectPromise) {
            return;
        }

        // Clear timeout
        if (this.waitTimeout) {
            clearTimeout(this.waitTimeout);
            this.waitTimeout = null;
        }

        this.isWaiting = false;
        this.currentRequest = null;
        
        // Unregister from adapter
        const adapter = this.getAdapter();
        adapter.unregisterWaitingSession(this.sessionId);
        
        this.rejectPromise(new Error(reason));
        this.resolvePromise = null;
        this.rejectPromise = null;
    }

    /**
     * Check if the current user has explicit permission for a resource.
     * Uses requireAllowed (explicit allow) — the user must actively possess the permission.
     *
     * Usage:
     *   const denied = await ctx.require("admin.permission");
     *   if (denied) return denied;
     */
    public async require(perm: string): Promise<string | null> {
        const { getPermissionService } = await import("../permission/index.js");
        const userId = this.event?.userId;
        if (!userId) {
            return "无法获取用户身份。";
        }
        const allowed = await getPermissionService().requireAllowed(userId, perm);
        if (!allowed) {
            return `权限不足: 需要 "${perm}" 权限。`;
        }
        return null;
    }

    /**
     * Get the current HITL request
     */
    public getCurrentRequest(): HITLRequest | null {
        return this.currentRequest;
    }
}

export class MessageTracker {
    private readonly trackId: string;
    //private readonly session: SessionContext<any>;
    private readonly stages: Array<{ stage: string; data?: Record<string, any> }> = [];
    constructor(session: SessionContext<any>) {
        this.trackId = randomUUID();
        // this.session = session;
    }
    public getTrackId(): string {
        return this.trackId;
    }
    public push(stage: string, data?: Record<string, any>) {
        this.stages.push({ stage, data });
    }
    public save() {
        // TODO: Save the tracking information to a database.
    }
}
