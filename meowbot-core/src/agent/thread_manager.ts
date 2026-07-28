/**
 * ThreadManager — compact and clear agent conversation threads.
 *
 * Compact: reads the full message history, asks an LLM to produce a concise
 * summary, then replaces the history with the summary + the last few messages.
 *
 * Clear: wipes all checkpoints for a given thread_id from the LangGraph
 * checkpointer collection.
 */

import { SystemMessage, HumanMessage, AIMessage, RemoveMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { modelRegistry } from "@meowbot/llm";
import { Prompts } from "@meowbot/template/prompts";
import { getLogger } from "@meowbot/utils/logs";
import type { CompiledStateGraph } from "@langchain/langgraph";

const logger = getLogger("ThreadManager");

export interface CompactResult {
    threadId: string;
    originalCount: number;
    compactedCount: number;
    summary: string;
}

/**
 * Compact a thread: summarize all messages and keep only summary + tail.
 * @param graph - The agent's compiled state graph
 * @param threadId - Thread ID to compact
 * @param keepLast - Number of most recent messages to keep (default: 3)
 */
export async function compactThread(
    graph: CompiledStateGraph<any, any, any>,
    threadId: string,
    keepLast: number = 3,
): Promise<CompactResult> {
    const config = { configurable: { thread_id: threadId } };
    let state: any;

    try {
        state = await graph.getState(config);
    } catch {
        throw new Error("Thread not found: " + threadId);
    }

    const messages: BaseMessage[] = state.values?.messages ?? [];
    const originalCount = messages.length;
    const currentMessages = state.values.messages || [];
    const deleteCommands = currentMessages.map((msg: { id: any; }) => new RemoveMessage({ id: msg.id }));
    if (originalCount <= keepLast + 1) {
        return {
            threadId,
            originalCount,
            compactedCount: originalCount,
            summary: "(nothing to compact)",
        };
    }

    // Build a text transcript for the LLM to summarize
    const transcript = messages.map((m, i) => {
        const role = m instanceof HumanMessage ? "User" : m instanceof AIMessage ? "AI" : "System";
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return "[" + role + " #" + i + "] " + content;
    }).join("\n");

    const compactPrompt = await Prompts.build("context-compact", {});

    const model = modelRegistry.getModel("compactor");
    const response = await model.invoke([
        new SystemMessage(compactPrompt || "Summarize the following conversation concisely."),
        new HumanMessage("Summarize this conversation. Keep everything important:\n\n" + transcript),
    ]);

    const summary = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Build new message list: summary as system message + last N messages
    const newMessages: BaseMessage[] = [
        new SystemMessage("[Conversation summary]\n" + summary),
        ...messages.slice(-keepLast),
    ];

    // Write back via LangGraph updateState



    if (deleteCommands.length > 0) {
        await graph.updateState(config, { messages: deleteCommands });
    }

    await graph.updateState(config, { messages: newMessages });

    const compactedCount = newMessages.length;

    logger.info(
        "[ThreadManager] Compacted " + threadId +
        ": " + originalCount + " -> " + compactedCount + " messages",
    );

    return { threadId, originalCount, compactedCount, summary };
}

/**
 * Clear a thread: use LangGraph updateState to wipe the conversation history.
 * @param graph - The agent's compiled state graph
 * @param threadId - Thread ID to clear
 */
export async function clearThread(
    graph: CompiledStateGraph<any, any, any>,
    threadId: string,
): Promise<void> {
    const config = { configurable: { thread_id: threadId } };
    const currentState = await graph.getState(config);
    const currentMessages = currentState.values.messages || [];
    const deleteCommands = currentMessages.map((msg: { id: any; }) => new RemoveMessage({ id: msg.id }));

    if (deleteCommands.length > 0) {
        await graph.updateState(config, { messages: deleteCommands });
    }
    logger.info("[ThreadManager] Cleared thread " + threadId);
}
