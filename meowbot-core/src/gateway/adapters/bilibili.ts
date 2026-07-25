/**
 * Bilibili adapter
 *
 * Bridges Bilibili private messages into the meowbot gateway.
 *
 * Features:
 *   - QR-code login via @seiuna/bilibili-api (persistent config)
 *   - Polls session list for incoming private messages
 *   - Sends text replies back via Bilibili web IM API
 *
 * Limitations:
 *   - Image/file sending in private messages is not implemented yet.
 */

import { BaseAdapter, MessageData, MessageEvent } from "./types.js";
import { SessionContext, SessionType } from "../index.types.js";
import { getLogger } from "../../utils/logs.js";
import { BiliClient, QrcodeStatus, ChatSession, ChatMessage } from "@seiuna/bilibili-api";
import { randomUUID } from "node:crypto";

const logger = getLogger("BilibiliAdapter");

const DEFAULT_CONFIG_PATH = "config/bili-config.json";
const POLL_INTERVAL_MS = 5000;

interface ParsedChatContent {
    content?: string;
    url?: string;
    [key: string]: any;
}

export class BilibiliAdapter extends BaseAdapter {
    public name = "bilibili";
    private client?: BiliClient;
    private configPath: string;
    private pollTimer: NodeJS.Timeout | null = null;
    private lastSeqno = new Map<number, number>();
    private myMid = 0;

    constructor(configPath: string = process.env.BILI_CONFIG_PATH || DEFAULT_CONFIG_PATH) {
        super({
            name: "bilibili",
            version: "1.0.0",
            description: "Bilibili private message adapter",
        });
        this.configPath = configPath;
        this.on("message", this.onOutboundMessage.bind(this));
    }

    public async connect(): Promise<void> {
        logger.info(`Connecting to Bilibili (config: ${this.configPath})`);

        this.client = await BiliClient.create(this.configPath);

        const login = await this.client.ensureLogin({
            pollInterval: 2000,
            timeout: 180_000,
            onStatusChange: (status, msg, _base64, terminal) => {
                logger.info(`[Bilibili login] ${status}: ${msg}`);
                if (status === QrcodeStatus.NOT_SCANNED && terminal) {
                    // eslint-disable-next-line no-console
                    console.log(terminal);
                }
            },
        });

        if (!login.success) {
            throw new Error(`Bilibili login failed: ${login.message}`);
        }

        const { loggedIn, mid } = await this.client.isLoggedIn();
        if (!loggedIn || !mid) {
            throw new Error("Bilibili login succeeded but isLoggedIn returned false");
        }

        this.myMid = mid;
        logger.info(`Bilibili logged in, mid: ${this.myMid}`);

        this.startPolling();
    }

    public async disconnect(): Promise<void> {
        this.stopPolling();
        logger.info("Bilibili adapter disconnected");
    }

    public async currentState(): Promise<"dead" | "alive"> {
        if (!this.client) return "dead";
        const { loggedIn } = await this.client.isLoggedIn();
        return loggedIn ? "alive" : "dead";
    }

    private startPolling(): void {
        if (this.pollTimer) return;
        this.pollTimer = setInterval(() => {
            this.pollSessions().catch((err) => {
                logger.error(`Bilibili polling error: ${err}`);
            });
        }, POLL_INTERVAL_MS);
        // First poll immediately
        this.pollSessions().catch((err) => logger.error(`Bilibili initial poll error: ${err}`));
    }

    private stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private async pollSessions(): Promise<void> {
        if (!this.client) return;

        for await (const page of this.client.chat.sessions(4 /* ALL */, 20)) {
            for (const session of page.sessions) {
                await this.handleSession(session);
            }
        }
    }

    private async handleSession(session: ChatSession): Promise<void> {
        const lastMsg = session.last_msg;
        if (!lastMsg) return;

        // Ignore messages sent by ourselves.
        if (lastMsg.sender_uid === this.myMid) return;

        const lastProcessed = this.lastSeqno.get(session.talker_id) ?? -1;
        if (lastMsg.msg_seqno <= lastProcessed) return;

        this.lastSeqno.set(session.talker_id, lastMsg.msg_seqno);

        const messageEvent = this.buildMessageEvent(session, lastMsg);

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

    private buildMessageEvent(session: ChatSession, msg: ChatMessage): MessageEvent {
        const parsed = this.parseContent(msg.content);
        const userId = String(msg.sender_uid);
        const username = session.account_info?.name || userId;
        const timestamp = msg.timestamp * 1000;
        const messageId = String(msg.msg_key);

        return {
            adapter: this.name,
            message: parsed.content || "",
            userId,
            username,
            timestamp,
            messageId,
            publicId: undefined,
            uniqueId: {
                adapter: this.name,
                messageId,
                id: userId,
            },
            extraPayload: { images: [], sounds: [], files: [] },
            extra: {
                source: "bilibili_private",
                metaData: {
                    messageId,
                    message: parsed.content || "",
                    userId,
                    username,
                    talkerId: session.talker_id,
                    sessionType: session.session_type,
                    msgKey: msg.msg_key,
                },
            },
            reference: {
                MessageEvent: undefined as any,
                node: 0,
            },
        };
    }

    private parseContent(contentJson: string): ParsedChatContent {
        try {
            return JSON.parse(contentJson) as ParsedChatContent;
        } catch {
            return { content: contentJson };
        }
    }

    private async onOutboundMessage(handleSource: string, originData: SessionContext<SessionType>, content: MessageData): Promise<void> {
        if (!this.client) return;

        const event = originData.event;
        const metaData = event.extra?.metaData;
        if (!metaData || typeof metaData.talkerId !== "number") {
            logger.warn("Cannot send Bilibili message: missing talkerId in origin metadata");
            return;
        }

        const talkerId = metaData.talkerId as number;
        const textParts: string[] = [];

        for (const msg of content) {
            if (msg.type === "text") {
                textParts.push(String(msg.data));
            } else {
                logger.warn(`Bilibili adapter does not yet support sending ${msg.type} messages`);
            }
        }

        if (textParts.length === 0) return;

        const text = textParts.join("\n");
        try {
            await this.sendPrivateMessage(talkerId, text);
            logger.debug(`Sent Bilibili private message to ${talkerId}`);
        } catch (error) {
            logger.error(`Failed to send Bilibili message: ${error}`);
        }
    }

    private async sendPrivateMessage(talkerId: number, text: string): Promise<void> {
        if (!this.client) throw new Error("Bilibili client not initialized");

        const csrf = this.extractCsrf();
        const devId = this.getOrCreateDevId();
        const timestamp = Math.floor(Date.now() / 1000);

        const content = JSON.stringify({ content: text });
        const body = new URLSearchParams();
        body.set("msg[sender_uid]", String(this.myMid));
        body.set("msg[receiver_id]", String(talkerId));
        body.set("msg[receiver_type]", "1");
        body.set("msg[msg_type]", "1");
        body.set("msg[content]", content);
        body.set("msg[timestamp]", String(timestamp));
        body.set("msg[dev_id]", devId);
        body.set("csrf", csrf);
        body.set("csrf_token", csrf);

        await this.client.checkedRequest<{ code: number; message: string }>(
            "https://api.vc.bilibili.com/web_im/v1/web_im/send_msg",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": "https://message.bilibili.com/",
                },
                body: body.toString(),
            }
        );
    }

    private extractCsrf(): string {
        const cookie = this.client?.config.data.cookie || "";
        const match = cookie.match(/bili_jct=([^;]+)/);
        if (!match) {
            throw new Error("Cannot extract csrf token (bili_jct) from Bilibili cookie");
        }
        return match[1];
    }

    private getOrCreateDevId(): string {
        // Bilibili expects a UUID-like dev_id. Reuse a stable one per session.
        const existing = process.env.BILI_DEV_ID;
        if (existing) return existing;
        return randomUUID().replace(/-/g, "").toUpperCase().slice(0, 32);
    }
}
