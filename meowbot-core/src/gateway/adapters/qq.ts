import { NapLink } from "@naplink/naplink";
import { BaseAdapter, BaseFile, BaseImage, MessageData, MessageEvent } from "./types.js";
import { SessionContext, SessionType } from "../index.types.js";
import { getLogger } from "../../utils/logs.js";
import { NapLinkConfig, NapLinkConfigSchema } from "@meowbot/shared";
import { createReactiveConfig } from "@meowbot/config";
import { getFileService } from "../../files/index.js";

const logger = getLogger("QQAdapter");

const MAX_REFERENCE_DEPTH = 5;

const DEFAULT_NAPLINK_CONFIG: NapLinkConfig = {
    url: process.env.NAPCAT_URL || "ws://127.0.0.1:3001",
    token: process.env.NAPCAT_TOKEN || "",
    napcat_path: process.env.NAPCAT_PATH || ""
};

const naplinkConfig = createReactiveConfig<NapLinkConfig>(
    "qq:naplink-config",
    DEFAULT_NAPLINK_CONFIG,
    NapLinkConfigSchema,
    (config) => {
        logger.info("QQ NapLink config updated");
    }
);

export class QQAdapter extends BaseAdapter {
    public name = "qq";
    public readonly client: NapLink;
    public botQq: string = "";

    constructor() {
        super({
            name: "qq",
            version: "1.0.0",
            description: "QQ message adapter, supports receiving and sending QQ group and private messages",
        });
        this.client = new NapLink({
            connection: naplinkConfig,
            reconnect: {
                enabled: false,
            },
            logging: { level: "error" },
        });
        this.on("message", this.onMessage.bind(this));
        this.on("notify", this.onNotify.bind(this));
    }

    /** Handle gateway.notify() — send a scheduled/automated message. */
    private async onNotify(payload: { publicId: string; userId: string; messages: any[] }): Promise<void> {
        try {
            if (payload.publicId) {
                await this.client.sendGroupMessage(payload.publicId, payload.messages);
            } else {
                await this.client.sendPrivateMessage(payload.userId, payload.messages);
            }
        } catch (error) {
            logger.error("Failed to send notify: " + error);
        }
    }

    private async onMessage(handleSource: string, originData: SessionContext<SessionType>, content: MessageData): Promise<void> {
        const event = originData.event;
        const metaData = event.extra?.metaData;
        if (!metaData) {
            logger.warn("No metadata found in message event");
            return;
        }

        try {
            const normalSegments: any[] = [];
            const fileSegments: any[] = [];
            const fs = getFileService();

            for (const msg of content) {
                switch (msg.type) {
                    case "text":
                        normalSegments.push({ type: "text" as const, data: { text: msg.data } });
                        break;
                    case "image":
                    case "voice": {
                        // Resolve fileId → base64 data URI, fall back to raw string for URLs
                        const resolved = (await fs.getBase64(msg.data)) ?? msg.data;
                        normalSegments.push({ type: "image" as const, data: { file: resolved } });
                        break;
                    }
                    case "at":
                        normalSegments.push({ type: "at" as const, data: { qq: msg.data } });
                        break;
                    case "reply":
                        normalSegments.push({ type: "reply" as const, data: { id: msg.data } });
                        break;
                    case "file": {
                        // Resolve fileId → { buffer, name } for upload
                        const buf = await fs.getBuffer(msg.data);
                        const meta = fs.getMeta(msg.data);
                        if (buf) {
                            fileSegments.push({ buffer: buf, name: meta?.name ?? "file" });
                        } else {
                            logger.warn(`Cannot resolve file: ${msg.data}`);
                        }
                        break;
                    }
                    default:
                        logger.warn(`Unknown message type: ${(msg as any).type}`);
                }
            }

            if (normalSegments.length > 0) {
                if (event.publicId) {
                    await this.client.sendGroupMessage(event.publicId, normalSegments);
                } else {
                    await this.client.sendPrivateMessage(metaData.userId, normalSegments);
                }
            }

            if (fileSegments.length > 0) {
                for (const fileData of fileSegments) {
                    const buffer = fileData.buffer;
                    const fileName = fileData.name;
                    const base64Str = buffer.toString("base64");
                    const base64Uri = `base64://${base64Str}`;
                    if (event.publicId) {
                        await this.client.uploadGroupFile(event.publicId, base64Uri, fileName);
                    } else {
                        await this.client.uploadPrivateFile(metaData.userId, base64Uri, fileName);
                    }
                }
            }

        } catch (error) {
            logger.error(`Failed to send message: ${error}`);
        }
    }
    /**
     * Connect to NapCat server
     */
    public async connect(): Promise<void> {
        this.client.on("connect", async () => {
            logger.info("Connected to NapCat");
            try {
                const loginInfo = await this.client.getLoginInfo();
                if (loginInfo && loginInfo.user_id) {
                    this.botQq = loginInfo.user_id.toString();
                    logger.info(`Bot QQ: ${this.botQq}`);
                }
            } catch (error) {
                logger.error("Failed to get login info: " + error);
            }
        });

        this.client.on("disconnect", () => {
            logger.warn("Disconnected from NapCat");
        });

        this.client.on("message.group", async (data) => {
            const isAtBot = this.botQq
                ? data.raw_message.includes(`[CQ:at,qq=${this.botQq}]`)
                : false;
            if (!isAtBot) return;

            const atRegex = this.botQq
                ? new RegExp(`\\[CQ:at,qq=${this.botQq}]\\s*`, "g")
                : new RegExp("\\[CQ:at,qq=\\d+\\]\\s*", "g");
            const content = data.raw_message.replace(atRegex, "").trim();

            await this.handleIncomingMessage(data, {
                source: "qq_group",
                threadIdKey: String(data.group_id),
                metaDataExtra: { groupId: String(data.group_id) },
                content,
            });
        });
        // file "[CQ:file,file=CMakeLists.txt,file_id=1d151b38f95b09df4de35ea1c783c368_3c96de34-768d-11f1-8816-c5a871ab41e0,file_size=694]"
        // raw_message ='[CQ:reply,id=17782225]123'
        this.client.on("message.private", async (data) => {
            await this.handleIncomingMessage(data, {
                source: "qq_private",
                threadIdKey: String(data.user_id),
                metaDataExtra: {},
                content: data.raw_message,
            });
        });

        try {
            await this.client.connect();
        } catch (error) {
            logger.error("Connection failed: " + error);
        }
    }



    /**
     * Disconnect from NapCat
     */
    public async disconnect(): Promise<void> {
        this.client.disconnect();
    }

    /**
     * Get current connection status
     */
    public async currentState(): Promise<"dead" | "alive"> {
        return this.client.isConnected() ? "alive" : "dead";
    }

    /**
     * 将 NapLink 消息转换为 MessageEvent 格式
     * @param data NapLink 消息数据
     * @param depth 当前引用深度
     * @returns 转换后的 MessageEvent
     */
    private async naplinkMessageToMessageEvent(data: any, depth: number): Promise<MessageEvent> {
        const IMG_REGEX = /\[CQ:image,.*?url=([^,\]]+).*?\]/g;
        const FILE_REGEX = /\[CQ:file,.*?\]/g;
        const REPLY_REGEX = /\[CQ:reply,id=\d+\]/g;
        const images = this.extractImages(data.raw_message);
        const files = await this.extractFiles(data.raw_message);
        const content = data.raw_message.replace(IMG_REGEX, "").replace(FILE_REGEX, "").replace(REPLY_REGEX, "").trim();
        const userId = String(data.user_id);
        const username = String(data.sender?.nickname || data.user_id);
        const timestamp = data.time ? data.time * 1000 : Date.now();
        const messageId = String(data.message_id);
        const publicId = data.group_id ? String(data.group_id) : undefined;

        return {
            adapter: this.name,
            message: content,
            userId,
            username,
            timestamp,
            publicId,
            messageId,
            uniqueId: {
                adapter: this.name,
                id: publicId || userId,
            },
            extraPayload: { images, sounds: [], files },
            extra: {
                source: publicId ? "qq_group" : "qq_private",
                metaData: {
                    messageId,
                    message: content,
                    userId,
                    username,
                    groupId: publicId,
                },
            },
            reference: {
                MessageEvent: undefined as any,
                node: depth,
            },
        };
    }

    /**
     * 递归构建引用链
     * @param data 当前消息数据
     * @param depth 当前深度
     * @returns 完整的引用链 MessageEvent
     */
    private async buildReferenceChain(data: any, depth: number): Promise<MessageEvent> {
        const messageEvent = await this.naplinkMessageToMessageEvent(data, depth);

        if (depth >= MAX_REFERENCE_DEPTH) {
            logger.warn(`Max reference depth (${MAX_REFERENCE_DEPTH}) reached`);
            return messageEvent;
        }

        const replyMatch = data.raw_message.match(/\[CQ:reply,id=(\d+)\]/);
        if (!replyMatch) {
            return messageEvent;
        }

        const replyId = replyMatch[1];
        logger.debug(`Found reply reference: ${replyId}, depth: ${depth}`);

        try {
            const replyMsg = await this.client.getMessage(replyId);
            if (!replyMsg) {
                logger.warn(`Reply message ${replyId} not found`);
                return messageEvent;
            }

            const referencedMessage = await this.buildReferenceChain(replyMsg, depth + 1);

            messageEvent.reference = {
                MessageEvent: referencedMessage,
                node: depth + 1,
            };

            logger.debug(`Reference chain built: depth ${depth} -> ${depth + 1}`);
        } catch (error) {
            logger.warn(`Failed to get reply message ${replyId}: ${error}`);
        }

        return messageEvent;
    }

    /**
     * Handle incoming messages (group or private)
     */
    private async handleIncomingMessage(
        data: any,
        opts: {
            source: "qq_group" | "qq_private";
            threadIdKey: string;
            metaDataExtra: Record<string, string | undefined>;
            content: string;
        }
    ): Promise<void> {
        const IMG_REGEX = /\[CQ:image,.*?url=([^,\]]+).*?\]/g;
        const FILE_REGEX = /\[CQ:file,.*?\]/g;
        const REPLY_REGEX = /\[CQ:reply,id=\d+\]/g;
        const images = this.extractImages(data.raw_message);
        const files = await this.extractFiles(data.raw_message);
        const content = opts.content.replace(IMG_REGEX, "").replace(FILE_REGEX, "").replace(REPLY_REGEX, "").trim();
        const userId = String(data.user_id);
        const username = String(data.sender?.nickname || data.user_id);
        const timestamp = data.time ? data.time * 1000 : Date.now();
        const messageId = String(data.message_id);

        const messageEvent = await this.buildReferenceChain(data, 0);
        messageEvent.timestamp = timestamp;
        messageEvent.message = content;
        messageEvent.uniqueId = {
            adapter: this.name,
            id: opts.metaDataExtra.groupId || userId,
        };
        messageEvent.extraPayload = { images, sounds: [], files };
        messageEvent.extra = {
            source: opts.source,
            metaData: {
                messageId,
                message: content,
                userId,
                username,
                ...opts.metaDataExtra,
            },
        };

        if (messageEvent.message.startsWith("/")) {
            this.handleCommandMessage({
                ...messageEvent,
                command: messageEvent.message.substring(1).split(" ")[0],
                args: messageEvent.message.substring(1).split(" ").slice(1),
            });
        } else {
            this.handleMessage(messageEvent);
        }
    }
    /**
 * Extract all BaseImage instances from a raw QQ message containing [CQ:image,...] codes
 * Deduplicates by fileid (or url), returns at most 2 images
 * @param rawMessage Raw QQ message string
 * @returns Array of BaseImage instances
 */
    private extractImages(rawMessage: string): BaseImage[] {
        const imgRegex = /\[CQ:image,.*?url=([^,\]]+).*?\]/g;
        const seen = new Set<string>();
        const images: BaseImage[] = [];
        let match: RegExpExecArray | null;
        while ((match = imgRegex.exec(rawMessage)) !== null) {
            const url = match[1].replaceAll('&amp;', '&');
            const fileid = BaseImage.extractFileIdFromUrl(url);
            const dedupKey = fileid ?? url;
            if (!seen.has(dedupKey) && images.length < 2) {
                seen.add(dedupKey);
                images.push(new BaseImage(url, fileid));
            }
        }
        return images;
    }

    /**
     * Extract all BaseFile instances from a raw QQ message containing [CQ:file,...] codes
     * @param rawMessage Raw QQ message string
     * @returns Array of BaseFile instances
     */
    private async extractFiles(rawMessage: string): Promise<BaseFile[]> {
        const fileRegex = /\[CQ:file,file=([^,]+),file_id=([^,]+),file_size=(\d+)\]/g;
        const seen = new Set<string>();
        const files: BaseFile[] = [];
        let match: RegExpExecArray | null;
        while ((match = fileRegex.exec(rawMessage)) !== null) {
            const fileName = match[1];
            const fileId = match[2];
            const fileSize = parseInt(match[3], 10);
            const fileUrl = await this.client.getFile(fileId);
            if (!seen.has(fileId)) {
                seen.add(fileId);
                files.push(new BaseFile(DEFAULT_NAPLINK_CONFIG.napcat_path + fileUrl.url.replace("/app/.config", ''), fileId, fileName, fileSize));
            }
        }
        return files;
    }
}



