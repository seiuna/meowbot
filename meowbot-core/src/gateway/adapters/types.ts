import EventEmitter from "node:events";
import { readFile } from "node:fs/promises";
import { MessageGateway } from "../message_gateway";
import { SessionContext, SessionType } from "../index.types";
import { SelectRequest, SelectOption, findMatchingOption } from "../hitl.js";
import z from "zod";
import { Holder } from "@meowbot/utils/holder";
import { getLogger } from "@meowbot/utils/logs";
import memoize from 'lodash/memoize';
import debounce from 'lodash/debounce';

const logger = getLogger("Adapter");
/**
 * Adapter metadata interface
 * Describes basic information about an adapter, used for registration and identification
 */
export interface AdapterMeta {
    /** Adapter name, must be unique */
    name: string;
    /** Adapter version */
    version: string;
    /** Adapter description */
    description: string;
}

/** A single message item in a MessageData array. */
export const messageItemSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("text"),
        data: z.string().describe("文本内容"),
    }).describe("文本消息"),
    z.object({
        type: z.literal("image"),
        data: z.string().describe("FileService fileId，如 'file_abc123' 或 'ws/main/img.png'。通过 FileService 统一解析为 base64"),
    }).describe("图片消息"),
    z.object({
        type: z.literal("at"),
        data: z.string().describe("被艾特的用户QQ号"),
    }).describe("艾特消息"),
    z.object({
        type: z.literal("reply"),
        data: z.string().describe("被回复的消息ID"),
    }).describe("回复/引用消息"),
    z.object({
        type: z.literal("voice"),
        data: z.string().describe("FileService fileId，如 'file_abc123'。通过 FileService 统一解析为 base64"),
    }).describe("语音消息"),
    z.object({
        type: z.literal("file"),
        data: z.string().describe("FileService fileId，如 'file_abc123'。通过 FileService 统一解析为 base64"),
    }).describe("文件消息"),
]);

/** Message item type inferred from the schema. */
export type MessageItem = z.infer<typeof messageItemSchema>;

/**
 * Represents the standardized data payload returned by all agents or commands.
 * An array of typed message items — each item has a `type` discriminator and
 * a shape-specific `data` field.
 *
 * Examples:
 *   [{ type: "text", data: "Hello!" }]
 *   [{ type: "file", data: "file_abc123" }]
 *   [{ type: "image", data: "file_abc123" }]
 */
export const messageSchema = z.array(messageItemSchema);
export type MessageData = z.infer<typeof messageSchema>;
export type HandleSource = "Command" | "Agent" | "SubAgent" | "Tools";
/**
 * Callback events interface
 * Defines the events that can be emitted by the adapter
 */
export interface CallBackEvents {
    /**
     * Emitted when a new message is successfully generated or received.
     * 
     * @param originData The original message or command event that triggered this response.
     * @param content The actual message data payload being transmitted.
     */
    'message': [handleSource: HandleSource, originData: SessionContext<SessionType>, content: MessageData];

    /**
     * Emitted by gateway.notify() to deliver scheduled/automated messages.
     * Adapters listen to this and send to the target user/channel.
     */
    'notify': [payload: { publicId: string; userId: string; messages: MessageData }];

    /**
     * Emitted when the processing of a message or command is completely finished.
     * Useful for cleaning up resources or resolving promises.
     * 
     * @param originData The original message or command event that has finished processing.
     */
    'finish': [originData: SessionContext<SessionType>];

    /**
     * Emitted to send control signals or lifecycle updates (e.g., typing indicators, state changes).
     * 
     * @param originData The original message or command event associated with this control signal.
     * @param controlType The specific type or identifier of the control signal.
     * @param controlData Optional extra data payload associated with the specific control type.
     */
    'control': [originData: SessionContext<SessionType>, controlType: string, controlData?: any];

    /**
     * Emitted when an unexpected error occurs during the processing of a message or command.
     * 
     * @param originData The original message or command event being processed when the error occurred.
     * @param error The error instance containing the failure details.
     */
    'exception': [originData: SessionContext<SessionType>, message: Error];
}

export abstract class BaseAdapter extends EventEmitter<CallBackEvents> {
    /**
     * The gateway instance this adapter is connected to
     * Auto-injected by the Gateway when the adapter is registered
     */
    private gateway!: MessageGateway;

    /** Adapter metadata */
    private meta: AdapterMeta;

    /** HITL waiting sessions, keyed by sessionId */
    private waitingSessions: Map<string, SessionContext<SessionType>> = new Map();


    /**
     * @param meta Adapter metadata information
     */
    constructor(meta: AdapterMeta) {
        super();
        this.meta = meta;
        this.on("message", this._onMessage.bind(this));
    }

    /**
     * Get adapter metadata
     * @returns Adapter metadata object
     */
    public getMeta(): AdapterMeta {
        return this.meta;
    }

    /**
     * Get the gateway instance associated with this adapter
     * @returns MessageGateway instance
     */
    public getGateway(): MessageGateway {
        return this.gateway;
    }

    /**
     * Set the gateway instance (called automatically during registration)
     * @param gateway Gateway instance
     */
    public setGateway(gateway: MessageGateway): void {
        this.gateway = gateway;
    }

    /**
     * Get a message builder for constructing MessageEvent objects
     * Automatically sets the adapter name to the current adapter's name
     * @returns MessageEventBuilder instance
     */
    public getMessageBuilder(): MessageEventBuilder {
        return new MessageEventBuilder().setAdapter(this.meta.name);
    }


    /**
     * Connect to the platform (abstract method)
     * Subclasses must implement the actual connection logic, e.g. establishing WebSocket connections
     */
    public abstract connect(): Promise<void>;

    /**
     * Disconnect from the platform (abstract method)
     * Subclasses must implement the actual disconnection logic
     */
    public abstract disconnect(): Promise<void>;

    /**
     * Get current connection status (abstract method)
     * @returns "dead" if disconnected, "alive" if connected
     */
    public abstract currentState(): Promise<"dead" | "alive">;

    // ── HITL Session Management ──

    /**
     * Register a session as waiting for HITL response
     * @param session - The session context that is waiting
     */
    public registerWaitingSession(session: SessionContext<SessionType>): void {
        this.waitingSessions.set(session.sessionId, session);
        logger.debug(`[${this.meta.name}] Registered waiting session: ${session.sessionId}`);
    }

    /**
     * Unregister a session from waiting
     * @param sessionId - The session ID to unregister
     */
    public unregisterWaitingSession(sessionId: string): void {
        this.waitingSessions.delete(sessionId);
        logger.debug(`[${this.meta.name}] Unregistered waiting session: ${sessionId}`);
    }

    /**
     * Get a waiting session by session ID
     * @param sessionId - The session ID
     * @returns The waiting session or undefined
     */
    public getWaitingSession(sessionId: string): SessionContext<SessionType> | undefined {
        return this.waitingSessions.get(sessionId);
    }

    /**
     * Get all waiting sessions
     * @returns Map of waiting sessions
     */
    public getWaitingSessions(): Map<string, SessionContext<SessionType>> {
        return new Map(this.waitingSessions);
    }

    /**
     * Check if a session is waiting
     * @param sessionId - The session ID
     * @returns True if the session is waiting
     */
    public isSessionWaiting(sessionId: string): boolean {
        return this.waitingSessions.has(sessionId);
    }

    /**
     * Check if any session is waiting
     * @returns True if any session is waiting
     */
    public hasWaitingSessions(): boolean {
        return this.waitingSessions.size > 0;
    }

    /**
     * Handle incoming message and check if it's a HITL response
     * Call this method in your message handler before processing normal messages
     * @param message - The incoming message event
     * @returns True if the message was handled as a HITL response
     */
    protected handleHITLResponseIfWaiting(message: MessageEvent): boolean {
        // Check if this user has a waiting session
        for (const [sessionId, session] of this.waitingSessions) {
            if (session.event.userId === message.userId) {
                // Parse the response
                const request = (session as any).getCurrentRequest();
                if (request) {
                    const response = this.parseHITLResponse(request, message.message);
                    if (response) {
                        // If response has error, notify via onError callback and send error message
                        if (response.type === "select" && response.error) {
                            if (request.onError) {
                                request.onError(message.message, response.error);
                            }
                            this.emit("message", "Agent", session, [{ type: "text", data: response.error }]);
                            return true;
                        }
                        session.resolve(response);
                        logger.debug(`[${this.meta.name}] HITL response resolved for session: ${sessionId}`);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Parse user message into HITL response
     * Override this method in subclasses for custom parsing logic
     * @param request - The HITL request
     * @param userMessage - The user's message
     * @returns Parsed HITL response or null if parsing failed
     */
    protected parseHITLResponse(request: import("../hitl.js").HITLRequest, userMessage: string): import("../hitl.js").HITLResponse | null {
        const message = userMessage.trim();

        switch (request.type) {
            case "select":
                return this.parseSelectResponse(request.options, message, request.allowCustom);
            case "confirm":
                return this.parseConfirmResponse(message);
            case "text":
                return this.parseTextResponse(message);
            default:
                return null;
        }
    }

    /**
     * Parse select response with option matching
     * @param options - The available options
     * @param message - User's input message
     * @param allowCustom - Whether custom input is allowed
     * @returns SelectSingleResponse with matched value or error
     */
    protected parseSelectResponse(
        options: SelectOption[],
        message: string,
        allowCustom?: boolean
    ): import("../hitl.js").SelectSingleResponse | null {
        // Try to match against options
        const matchResult = findMatchingOption(options, message);

        if (matchResult.matched) {
            return {
                type: "select",
                multiple: false,
                selected: matchResult.value!,
            };
        }

        // If custom input is allowed, return as custom text
        if (allowCustom) {
            return {
                type: "select",
                multiple: false,
                selected: null,
                customText: message,
            };
        }

        // Return error response
        return {
            type: "select",
            multiple: false,
            selected: null,
            error: matchResult.error || `无效的选项: "${message}"，请重新选择`,
        };
    }

    /**
     * Parse confirm response
     * Override for custom confirm parsing logic
     */
    protected parseConfirmResponse(message: string): import("../hitl.js").ConfirmResponse | null {
        const confirmKeywords = ["确认", "是", "yes", "y", "1", "确定", "好"];
        const cancelKeywords = ["取消", "否", "no", "n", "2", "不", "不要"];

        const lowerMessage = message.toLowerCase();

        if (confirmKeywords.some(kw => lowerMessage.includes(kw))) {
            return { type: "confirm", confirmed: true };
        }

        if (cancelKeywords.some(kw => lowerMessage.includes(kw))) {
            return { type: "confirm", confirmed: false };
        }

        if (message === "1") {
            return { type: "confirm", confirmed: true };
        }

        return { type: "confirm", confirmed: false };
    }

    /**
     * Parse text response
     * Override for custom text parsing logic
     */
    protected parseTextResponse(message: string): import("../hitl.js").TextResponse | null {
        return {
            type: "text",
            text: message,
        };
    }

    /**
     * Message queue - stores pending messages grouped by uniqueId
     * Key: uniqueId (session identifier)
     * Value: array of messages pending merge and processing
     */
    private messageQueue: Map<string, Array<MessageEvent>> = new Map();

    /**
     * Entry point for handling incoming messages
     * 
     * Core logic:
     * 1. Check if message is a HITL response (before queuing)
     * 2. Add message to the corresponding queue by uniqueId
     * 3. If user switches within the same session, immediately process previous messages
     * 4. Use debounce to merge consecutive messages from the same user (within 1s)
     * 
     * Message flow:
     * [New message arrives] → [Check HITL] → [Group by uniqueId] → [Check if user switched]
     *   ├─ HITL response → Resolve waiting session → Return
     *   ├─ User switched → Process old queue immediately → Create new queue → Start debounce
     *   └─ Same user → Add to queue → Reset debounce timer
     *   └─ No new message for 1s → Debounce triggers → Merge all messages → Send to Gateway
     * 
     * @param message Message event object
     */
    protected handleMessage(message: MessageEvent): void {
        // Check if this is a HITL response before queuing
        if (this.handleHITLResponseIfWaiting(message)) {
            return; // Handled as HITL response, don't queue
        }

        const uniqueId = message.uniqueId.toString();
        const queue = this.messageQueue.get(uniqueId);

        if (queue && queue.length > 0) {
            // Queue exists, check if same user
            const lastMessage = queue[queue.length - 1];

            if (lastMessage.userId !== message.userId) {
                // User switched: cancel current debounce, process previous user's messages immediately
                this.getDebouncedHandler(uniqueId).cancel();
                this._processQueue(uniqueId);
                // Create new queue for the new user
                this.messageQueue.set(uniqueId, [message]);
                this.getDebouncedHandler(uniqueId)();
                return;
            }

            // Same user, add message to queue for merging
            queue.push(message);
        } else {
            // Queue doesn't exist, create new queue
            this.messageQueue.set(uniqueId, [message]);
        }

        // Trigger debounce (reset 1s timer)
        this.getDebouncedHandler(uniqueId)();
    }

    /**
     * Get or create a debounced handler (memoized, one debounce instance per uniqueId)
     * 
     * Debounce mechanism: waits 1s with no new messages before processing the queue
     * This merges consecutive messages from the same user into one batch
     * 
     * @param uniqueId Session identifier
     * @returns Debounced handler function
     */
    private getDebouncedHandler = memoize((uniqueId: string) => {
        return debounce(() => {
            this._processQueue(uniqueId);
        }, 500);
    });

    /**
     * Send processed message to Gateway for further handling
     * @param uniqueId Session identifier
     * @param message Merged message event
     */
    private _handleMessage(uniqueId: string, message: MessageEvent): void {
        this.gateway.process(message, "message");
    }

    /**
     * Process message queue - merge all queued messages and send
     * 
     * Merge strategy:
     * 1. Text content: concatenated with newline \n
     * 2. Images/audio: merged into the same extraPayload arrays
     * 3. Extra data: merged using spread operator (latter overwrites former)
     * 
     * Flow:
     * [Dequeue all messages] → [Iterate and merge] → [Send to Gateway] → [Cleanup queue and cache]
     * 
     * @param uniqueId Session identifier
     */
    private _processQueue(uniqueId: string): void {
        const messages = this.messageQueue.get(uniqueId) || [];
        if (messages.length === 0) return;

        let mergedMessage: MessageEvent | undefined = undefined;

        // Iterate and merge all messages
        messages.forEach(msg => {
            if (mergedMessage === undefined) {
                // First message becomes the base
                mergedMessage = msg;
                return;
            }

            // Merge text content (newline separated)
            mergedMessage.message += "\n" + msg.message;
            
            // Merge multimedia content (images, audio, files)
            if (mergedMessage.extraPayload) {
                mergedMessage.extraPayload.images.push(...(msg.extraPayload?.images ?? []));
                mergedMessage.extraPayload.sounds.push(...(msg.extraPayload?.sounds ?? []));
                mergedMessage.extraPayload.files.push(...(msg.extraPayload?.files ?? []));
            }
            
            // Merge extra data (latter overwrites former)
            mergedMessage.extra = { ...mergedMessage.extra, ...msg.extra };
        });

        // Send merged message to Gateway
        if (mergedMessage) {
            this._handleMessage(uniqueId, mergedMessage);
        }
        
        // Cleanup: delete queue and debounce function cache
        this.messageQueue.delete(uniqueId);

        if (this.getDebouncedHandler.cache.delete) {
            this.getDebouncedHandler.cache.delete(uniqueId);
        }
    }

    /**
     * Handle a command message event
     * Dispatches the message through the Gateway with session type "command"
     * @param message Command event object, must contain command and args fields
     */
    protected handleCommandMessage(message: CommandEvent): void {
        this.gateway.process(message, "command");
    }


    private _onMessage(handleSource: HandleSource, originData: SessionContext<SessionType>, content: MessageData): void {
        logger.info(`Adapter ${this.meta.name} emitted [${handleSource}] message:`, content);
    }

}

/**
 * Message event interface
 * Defines the standard message format passed from platform adapters to the Gateway
 */
export interface MessageEvent {
    /** The adapter name that produced this message (e.g. "qq", "telegram") */
    adapter: string;
    /** Message text content */
    message: string;
    /** Sender's user ID */
    userId: string;
    /** Sender's username */
    username: string;
    /** Timestamp of the message */
    timestamp: number;
    /**
     * Public environment identifier
     * - QQ: group ID (e.g. "123456789")
     * - Discord: channel ID (e.g. "987654321")
     * - If undefined, the message is from a private/DM context
     */
    publicId?: string;
    /**
     * Unique message identifier within the adapter
     * Mapped to {adapter:messageId} format when sent to the Gateway
     */
    messageId: string;
    /**
     * Unique identifier field
     * - If Record<string, any>: Gateway merges its values with other parameters to compute an MD5 hash, then reassigns the hash back to this field
     * - If string: used directly as the unique identifier
     */
    uniqueId: Record<string, any> | string;
    /**
     * Extra payload data for carrying multimedia content such as images and audio
     */
    extraPayload?: ExtraPayload;
    /**
     * Extension data field
     * When an agent or specific components trigger callbacks, data in this field
     * can be used to construct and inject prompts or provide other necessary context
     */
    extra?: Record<string, any>;

    /**
     * The value of reference.node indicates the position of the current message in a chain of messages:
     * - 0: The current message is the first message in the chain (no previous messages)
     * - 1: The current message is the second message in the chain (one previous message)
     * - 2: The current message is the third message in the chain (two previous messages)
     * - ... and so on.
     * Max count of reference.node is 5, meaning the current message is the sixth message in the chain (five previous messages).
     * 
     * This allows for tracking and referencing previous messages in a conversation or thread.
     * 
     * If reference is undefined, it means the message not a reference to any previous message.
     */
    reference: {
        MessageEvent: MessageEvent;
        node: number;
    }

}

/**
 * Command event interface
 * Extends MessageEvent with command-related fields
 * Used for processing command messages with specific prefixes (e.g. /help, !status)
 * Additionally, when processing command messages, the field of message will be ignore
 */
export interface CommandEvent extends MessageEvent {
    /** Command name (e.g. "help", "status") */
    command: string;
    /** Command arguments list */
    args: string[];
}

/**
 * Message event builder
 * Uses the Builder pattern to construct MessageEvent or CommandEvent objects via method chaining
 */
export class MessageEventBuilder {
    /** Partial message event being built */
    private messageEvent: Partial<MessageEvent> = {};

    /**
     * Set the adapter name
     * @param adapter Adapter name
     * @returns Current builder instance (supports method chaining)
     */
    public setAdapter(adapter: string): MessageEventBuilder {
        this.messageEvent.adapter = adapter;
        return this;
    }
    /**
     * Set the timestamp
     * @param timestamp Timestamp of the message
     * @returns Current builder instance
     */
    public withTimestamp(timestamp: number): MessageEventBuilder {
        if (timestamp / 10000000000 <= 1) {
            // If timestamp is in seconds, convert to milliseconds
            timestamp *= 1000;
        }
        this.messageEvent.timestamp = timestamp;
        return this;
    }
    /**
     * Set the message content
     * @param message Message text
     * @returns Current builder instance
     */
    public withMessage(message: string): MessageEventBuilder {
        this.messageEvent.message = message;
        return this;
    }
    public withMessageId(messageId: string): MessageEventBuilder {
        this.messageEvent.messageId = messageId;
        return this;
    }
    /**
     * Set the user ID
     * @param userId User unique identifier
     * @returns Current builder instance
     */
    public withUserId(userId: string): MessageEventBuilder {
        this.messageEvent.userId = userId;
        return this;
    }

    public withReference(reference: { MessageEvent: MessageEvent; node: number }): MessageEventBuilder {
        this.messageEvent.reference = reference;
        return this;
    }

    /**
     * Set the username
     * @param username Username
     * @returns Current builder instance
     */
    public withUsername(username: string): MessageEventBuilder {
        this.messageEvent.username = username;
        return this;
    }

    /**
     * Set the unique identifier
     * @param uniqueId Unique identifier, can be a string or a key-value object
     * @returns Current builder instance
     */
    public withUniqueId(uniqueId: Record<string, any> | string): MessageEventBuilder {
        this.messageEvent.uniqueId = uniqueId;
        return this;
    }

    /**
     * Set the extra payload data
     * @param extraPayload Contains multimedia data such as images and audio
     * @returns Current builder instance
     */
    public withExtraPayload(extraPayload: ExtraPayload): MessageEventBuilder {
        this.messageEvent.extraPayload = extraPayload;
        return this;
    }

    /**
     * Set the extension data
     * @param extra Key-value pairs of extension data
     * @returns Current builder instance
     */
    public withExtra(extra: Record<string, any>): MessageEventBuilder {
        this.messageEvent.extra = extra;
        return this;
    }

    /**
     * Build and return a MessageEvent object
     * @returns Fully constructed MessageEvent instance
     */
    public build(): MessageEvent {
        return this.messageEvent as MessageEvent;
    }

    /**
     * Build and return a CommandEvent object
     * Adds command and args fields on top of MessageEvent
     * @param command Command name
     * @param args Command arguments list
     * @returns Fully constructed CommandEvent instance
     */
    public buildCommandEvent(command: string, args: string[]): CommandEvent {
        return {
            ...(this.messageEvent as MessageEvent),
            command,
            args
        };
    }

    public canWarpToCommandEvent(): boolean {
        return this.messageEvent.message?.trim().startsWith("/") ?? false;
    }

    /**
     * Build and return a CommandEvent object by parsing the message content
     * The message must start with a "/" to be considered a command
     * @throws Error if the message does not start with "/"
     * @returns 
     */
    public warpToCommandEvent(): CommandEvent {
        if (!this.canWarpToCommandEvent()) {
            throw new Error("Cannot warp to CommandEvent: message does not start with '/'");
        }
        const message = this.messageEvent.message?.trim() ?? "";
        const command = message.substring(1).split(" ")[0];
        const args = message.substring(1).split(" ").slice(1);
        return {
            ...(this.messageEvent as MessageEvent),
            command,
            args
        };
    }
}
/**
 * Extra payload interface
 * Used for carrying multimedia content (images, audio, etc.)
 */
export interface ExtraPayload {
    /** List of images */
    images: BaseImage[];
    /** List of audio */
    sounds: Array<any>;
    /** List of files */
    files: BaseFile[];
}

/**
 * Base file class
 * Encapsulates file URL, caching logic, and conversion methods
 * Provides common functionality for all file types (images, audio, video, etc.)
 */
export class BaseFile {
    /** File URL */
    protected readonly url: string;
    /** Unique file identifier, used as cache key */
    protected readonly fileid?: string;
    /** File name */
    protected readonly fileName?: string;
    /** File size in bytes */
    protected readonly fileSize?: number;
    /** Instance-level base64 cache data */
    protected base64Data?: string;
    /** Instance-level buffer cache data */
    protected bufferData?: Buffer;
    /** Local URL (optional) */
    protected localUrl?: string;

    /**
     * Shared LRU cache (max 10 entries)
     * Key is fileid (preferred) or url, value is base64 string
     * JavaScript Map iterates in insertion order - re-insert on access for LRU eviction
     */
    protected static base64Cache = new Map<string, string>();
    /** Maximum cache capacity */
    protected static readonly MAX_CACHE_SIZE = 10;

    /**
     * @param url File URL
     * @param fileid Optional unique file identifier
     * @param fileName Optional file name
     * @param fileSize Optional file size in bytes
     */
    constructor(url: string, fileid?: string, fileName?: string, fileSize?: number) {
        this.url = url;
        this.fileid = fileid;
        this.fileName = fileName;
        this.fileSize = fileSize;
    }

    /**
     * Get the file URL
     * @returns File URL string
     */
    public getUrl(): string {
        return this.url;
    }

    /**
     * Get the file identifier
     * @returns fileid or undefined
     */
    public getFileId(): string | undefined {
        return this.fileid;
    }

    /**
     * Get the file name
     * @returns file name or undefined
     */
    public getFileName(): string | undefined {
        return this.fileName;
    }

    /**
     * Get the file size in bytes
     * @returns file size in bytes or undefined
     */
    public getFileSize(): number | undefined {
        return this.fileSize;
    }

    /**
     * Get the cache key (prefer fileid, fallback to url)
     */
    protected get cacheKey(): string {
        return this.fileid ?? this.url;
    }

    /**
     * Fetch the file and return the Response object
     * @param timeout Request timeout in milliseconds
     * @returns Fetch Response
     * @throws Error if network request fails
     */
    protected async fetchFile(timeout: number = 10000): Promise<Response> {
        const response = await fetch(this.url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MEOWBOT/1.0',
            },
            signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status}`);
        }

        return response;
    }

    /**
     * Check if the URL is a local file path
     * @returns true if the URL is a local file path
     */
    protected isLocalPath(): boolean {
        return !this.url.startsWith("http://") && !this.url.startsWith("https://");
    }

    /**
     * Convert the file to a Buffer
     * Uses instance-level caching to avoid repeated downloads
     * Supports both local file paths and remote URLs
     * @returns Buffer containing the file data
     * @throws Error if network request or file read fails
     */
    public async toBuffer(): Promise<Buffer> {
        // 1. Check instance-level cache
        if (this.bufferData) {
            return this.bufferData;
        }

        try {
            // 2. Check if it's a local file path
            if (this.isLocalPath()) {
                this.bufferData = await readFile(this.url);
                return this.bufferData;
            }

            // 3. Download from network
            const response = await this.fetchFile();
            const ab = await response.arrayBuffer();
            this.bufferData = Buffer.from(ab);
            return this.bufferData;
        } catch (error) {
            throw new Error(`Failed to convert file to buffer: ${error}`);
        }
    }

    /**
     * Convert the file to a base64 string
     * Uses a two-level caching strategy:
     * 1. Instance-level cache (fastest access path)
     * 2. Shared LRU cache (shared across instances)
     * If neither cache hits, downloads from network and caches the result
     * @returns Base64 encoded file string with data: URI prefix
     * @throws Error if network request or conversion fails
     */
    public async toBase64(): Promise<string> {
        // 1. Check instance-level cache
        if (this.base64Data) {
            return this.base64Data;
        }
        // 2. Check shared LRU cache
        const cached = BaseFile.base64Cache.get(this.cacheKey);
        if (cached) {
            // Cache hit - move to front (delete + re-insert)
            BaseFile.base64Cache.delete(this.cacheKey);
            BaseFile.base64Cache.set(this.cacheKey, cached);
            this.base64Data = cached;
            return cached;
        }
        try {
            // 3. Download from network
            const response = await this.fetchFile();
            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const ab = await response.arrayBuffer();
            const buffer = Buffer.from(ab);
            this.base64Data = `data:${contentType};base64,${buffer.toString('base64')}`;
            this.bufferData = buffer;

            // Evict oldest entry if cache is full
            if (BaseFile.base64Cache.size >= BaseFile.MAX_CACHE_SIZE) {
                const oldest = BaseFile.base64Cache.keys().next().value;
                if (oldest !== undefined) {
                    BaseFile.base64Cache.delete(oldest);
                }
            }
            // Store in shared cache
            BaseFile.base64Cache.set(this.cacheKey, this.base64Data);
            return this.base64Data;
        } catch (error) {
            throw new Error(`Failed to convert file to base64: ${error}`);
        }
    }

    /**
     * Extract fileid query param from a download URL
     * @param url Download URL
     * @returns Extracted fileid, or undefined if extraction fails
     * @example
     * // Input: https://...download?appid=1407&fileid=EhTbYl...&rkey=...
     * // Output: "EhTbYl..."
     */
    static extractFileIdFromUrl(url: string): string | undefined {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('fileid') ?? undefined;
        } catch {
            // Fallback regex for malformed URLs
            const match = url.match(/[?&]fileid=([^&]+)/);
            return match ? decodeURIComponent(match[1]) : undefined;
        }
    }
}

/**
 * Base image class
 * Extends BaseFile with image-specific functionality
 */
export class BaseImage extends BaseFile {
    /**
     * @param url Image URL
     * @param fileid Optional unique file identifier
     * @param fileName Optional file name
     * @param fileSize Optional file size in bytes
     */
    constructor(url: string, fileid?: string, fileName?: string, fileSize?: number) {
        super(url, fileid, fileName, fileSize);
    }
}
