/**
 * Message validation utilities for LangGraph agents.
 *
 * Validates that AIMessage tool_calls are properly paired with
 * corresponding ToolMessages (matching tool_call_id).
 * Detects and fixes the common LangChain error:
 *   "An assistant message with 'tool_calls' must be followed by tool messages"
 */

import { AIMessage, AIMessageChunk, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { RemoveMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("MessageValidator");

export interface ValidationResult {
    /** Whether the message list is valid (all tool_calls properly paired). */
    valid: boolean;
    /** The cleaned message list (problematic messages removed). */
    messages: BaseMessage[];
    /** Number of messages removed. */
    removed: number;
    /** Explanation of what was fixed (empty if valid). */
    reason: string;
}

/**
 * Validate that all AIMessage tool_calls have matching ToolMessages.
 *
 * Scans from the end backwards to find the last consistent state.
 * Any trailing unmatched AIMessage (with tool_calls) and its descendants
 * are removed.
 */
export function validateToolCallPairing(messages: BaseMessage[]): ValidationResult {
    if (messages.length === 0) {
        return { valid: true, messages, removed: 0, reason: "" };
    }

    // Track unmatched tool_call_ids: we need a ToolMessage for each
    const pendingToolCalls = new Map<string, number>(); // tool_call_id → message index

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // Collect tool_call_ids from AIMessage
        if (msg instanceof AIMessage || msg instanceof AIMessageChunk) {
            const toolCalls = (msg as any).tool_calls;
            if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    if (tc.id) {
                        pendingToolCalls.set(tc.id, i);
                    }
                }
            }
        }

        // Resolve tool_call_ids from ToolMessage
        if (msg instanceof ToolMessage || (msg as any)._getType?.() === "tool") {
            const tcId = (msg as any).tool_call_id;
            if (tcId && pendingToolCalls.has(tcId)) {
                pendingToolCalls.delete(tcId);
            }
        }
    }

    // If all tool_calls are resolved, we're good
    if (pendingToolCalls.size === 0) {
        return { valid: true, messages, removed: 0, reason: "" };
    }

    // Find the earliest unmatched AIMessage index — everything from there onward is suspect
    let earliestUnmatched = messages.length;
    for (const idx of pendingToolCalls.values()) {
        if (idx < earliestUnmatched) {
            earliestUnmatched = idx;
        }
    }

    // Remove from the earliest unmatched AIMessage to the end
    const cleaned = messages.slice(0, earliestUnmatched);
    const removed = messages.length - cleaned.length;
    const unmatchedIds = Array.from(pendingToolCalls.keys()).join(", ");

    logger.warn(
        `[MessageValidator] Removed ${removed} message(s) — ` +
        `unmatched tool_call_id(s): ${unmatchedIds}. ` +
        `Reverted to index ${earliestUnmatched}/${messages.length}`
    );

    return {
        valid: false,
        messages: cleaned,
        removed,
        reason: `Removed ${removed} trailing message(s) due to unmatched tool_call_id(s): ${unmatchedIds}`,
    };
}

/**
 * LangGraph node: validates and repairs message pairing before the executor runs.
 *
 * Usage in StateGraph:
 *   .addNode("messageValidator", messageValidatorNode)
 *   .addEdge("__start__", "messageValidator")
 *   .addEdge("messageValidator", "executor")
 */
export async function messageValidatorNode<S extends { messages: BaseMessage[] }>(
    state: S,
    _config?: RunnableConfig,
): Promise<Partial<S>> {
    const result = validateToolCallPairing(state.messages);

    if (result.valid) {
        return {} as Partial<S>;
    }

    // Build RemoveMessage commands for the removed messages
    const removedMsgs = state.messages.slice(state.messages.length - result.removed);
    const deleteCommands = removedMsgs
        .filter((m: any) => m.id)
        .map((m: any) => new RemoveMessage({ id: m.id }));

    // Also push a system note about the fix
    return {
        messages: deleteCommands.length > 0 ? deleteCommands : [],
    } as unknown as Partial<S>;
}
