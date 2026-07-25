import { MessageGateway } from "./message_gateway";
import { BaseAdapter, CommandEvent, MessageData, MessageEvent, HandleSource } from "./adapters/types";
import { Holder } from "@meowbot/utils/holder";
import { randomUUID } from "crypto";
import { IUserProfile } from "@meowbot/database/models";
import { HITLRequest, HITLResponse, HITLWaitResult } from "./hitl.js";
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
    attachResult,
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
    /** Current HITL request — used by adapter to parse responses */
    public currentRequest: HITLRequest | null = null;
    /** Source of message emission — set automatically, can be overridden by tools/sub-agents */
    public handleSource: HandleSource;
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
     * Wait for user interaction (HITL).
     * Delegates entirely to the adapter which owns the complete lifecycle.
     */
    public async wait<T extends HITLRequest>(request: T): Promise<HITLWaitResult<T>> {
        if (this.isWaiting) {
            throw new Error("Session is already waiting for HITL response");
        }
        this.isWaiting = true;
        this.currentRequest = request;
        try {
            const adapter = this.getAdapter();
            return await adapter.waitForHITL(this, request);
        } catch (err) {
            this.isWaiting = false;
            this.currentRequest = null;
            throw err;
        }
    }

    /** @deprecated HITL request sending is now handled by adapter. */
    private sendHITLRequest(_request: HITLRequest): void {}

    /** Clear timeout and reset waiting state. Used by adapter after resolution. */
    public clearWait(): void {
        this.isWaiting = false;
        if (this.waitTimeout) { clearTimeout(this.waitTimeout); this.waitTimeout = null; }
    }

    /**
     * Resolve a waiting session (HITL) — delegates to the adapter.
     */
    public resolve(response: HITLResponse): void {
        const adapter = this.getAdapter();
        if (adapter) {
            // adapter.waitForHITL stores resolve on __hitlResolve
            const resolveFn = (this as any).__hitlResolve;
            if (resolveFn) {
                delete (this as any).__hitlResolve;
                resolveFn(response);
                this.clearWait();
            }
        }
    }

    /**
     * Reject a waiting session (HITL).
     */
    public reject(reason: string): void {
        const adapter = this.getAdapter();
        if (adapter && adapter.hasWaitingSessions()) {
            adapter.unregisterWaitingSession(this.sessionId);
        }
        this.clearWait();
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
