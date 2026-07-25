import { getEncoding } from "js-tiktoken";
import type { BaseMessage } from "@langchain/core/messages";

let encoder: ReturnType<typeof getEncoding> | null = null;

function getEncoder() {
    if (!encoder) {
        encoder = getEncoding("cl100k_base");
    }
    return encoder;
}

function normalizeContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map((item: any) => item?.text ?? "").join(" ");
    }
    if (content && typeof content === "object" && "text" in (content as any)) {
        return String((content as any).text ?? "");
    }
    return "";
}

export function estimateTokens(text: string): number {
    if (!text) return 0;
    const enc = getEncoder();
    return enc.encode(text).length;
}

export function estimateMessagesTokens(messages: BaseMessage[]): number {
    const joined = messages.map(msg => normalizeContent(msg.content)).join("\n");
    return estimateTokens(joined);
}

export function estimateToolPayloadTokens(toolName: string, thought: string, inputs: unknown): number {
    const payload = JSON.stringify({ toolName, thought, inputs });
    return estimateTokens(payload);
}
