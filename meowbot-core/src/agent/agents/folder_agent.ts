/**
 * FolderAgent — a generic LangGraph agent driven by /agents/{name}/AGENT.md config.
 *
 * Replaces the hardcoded DefaultAgent. Each AGENT.md defines:
 *   - name, description, prompt (from /prompts or inline)
 *   - tools (essential bootstrap tools)
 *
 * All other tools are discoverable via search_tools + call_tools at runtime.
 */

import { Annotation, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import type { CompiledStateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BaseAgent } from "../types.js";
import { SessionContext, SessionType } from "@meowbot/gateway/index.types";
import { modelRegistry } from "@meowbot/llm/index.js";
import { getLogger } from "@meowbot/utils/logs.js";
import { checkpointer } from "../checkpointer.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { toolRegistry } from "../../tools/tool_registry.js";
import { compactThread } from "../thread_manager.js";
import type { MessageItem } from "@meowbot/gateway/adapters/types";
import type { AgentConfig } from "../agent_config.js";
import type { PendingDecoration } from "../../tools/other/tools_other.js";

const logger = getLogger("FolderAgent");

// ── State ──
const AgentState = Annotation.Root({
    ...MessagesAnnotation.spec,
    session: Annotation<any>(),
    filtered: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),
    filteredMessage: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
});

// ── FolderAgent ──

export class FolderAgent extends BaseAgent {
    private config: AgentConfig;
    private fewShot: Array<{ human: string; ai: string }>;
    private app: CompiledStateGraph<typeof AgentState.State, any, any>;
    private skillCache: { tools: DynamicStructuredTool[]; prompt: string; fewshot: () => BaseMessage[] } | null = null;
    private filterCache = new Map<string, { blocked: boolean; at: number }>();

    constructor(config: AgentConfig, fewShot: Array<{ human: string; ai: string }> = []) {
        super(config.name, config.description, config.tools);
        this.config = config;
        this.fewShot = fewShot;
        this.app = this.buildGraph();
    }

    // ── Skill resolution ──

    private async resolveSkill(): Promise<{ tools: DynamicStructuredTool[]; prompt: string; fewshot: () => BaseMessage[] }> {
        if (!this.skillCache) {
            // Prompt comes directly from AGENT.md body (after YAML frontmatter)
            const promptBody = this.config.prompt || this.config.description;

            // Get tools from all registered providers matching the agent's tools list
            const allToolNames = new Set(this.config.tools);
            const allTools = toolRegistry.getAllTools().filter(
                t => allToolNames.has(t.name) && (t as any).isEnabled !== false
            );

            this.skillCache = {
                tools: Array.from(new Set(allTools)) as DynamicStructuredTool[],
                prompt: promptBody,
                fewshot: () => {
                    const msgs: BaseMessage[] = [];
                    for (const pair of this.fewShot) {
                        msgs.push(new HumanMessage({ content: pair.human }));
                        msgs.push(new AIMessage({ content: pair.ai }));
                    }
                    return msgs;
                },
            };
        }
        return this.skillCache;
    }

    // ── Graph ──

    private buildGraph() {
        return new StateGraph(AgentState)
            .addNode("executor", this.executorNode.bind(this))
            .addNode("tools", this.toolsNode.bind(this))
            .addEdge("__start__", "executor")
            .addConditionalEdges("executor", this.routeAfterExecutor.bind(this), {
                tools: "tools",
                __end__: "__end__",
            })
            .addEdge("tools", "executor")
            .compile({ checkpointer: checkpointer.mongoCheckpointer });
    }

    private async executorNode(state: typeof AgentState.State, config: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
        const skill = await this.resolveSkill();
        const model = modelRegistry.getModel("executor").bindTools(skill.tools);
        const messages = [new SystemMessage(skill.prompt), ...skill.fewshot(), ...state.messages];
        const response = await model.invoke(messages, config);
        return { messages: [response] };
    }

    private async toolsNode(state: typeof AgentState.State, config: RunnableConfig): Promise<Partial<typeof AgentState.State>> {
        const skill = await this.resolveSkill();
        const toolNode = new ToolNode(skill.tools);
        return toolNode.invoke(state, config);
    }

    private routeAfterExecutor(state: typeof AgentState.State): string {
        const last = state.messages[state.messages.length - 1];
        if ((last instanceof AIMessage || last instanceof AIMessageChunk) && last.tool_calls && last.tool_calls.length > 0) {
            return "tools";
        }
        return "__end__";
    }

    // ── Handle Session ──

    protected async handleSession(session: SessionContext<SessionType>): Promise<void> {
        logger.info(`[${this.config.name}] handling session: ${session.sessionId}`);

        try {
            const userMessage = await this.buildIncomeMessage(session);
            const config: RunnableConfig = {
                configurable: { thread_id: session.threadId, session },
            };
            const stream = await this.app.streamEvents({ messages: [userMessage] }, { ...config, version: "v3" });

            let isFirstText = true;
            const pendingDeco = (session as any).pendingDecoration as PendingDecoration | null;
            if (pendingDeco) delete (session as any).pendingDecoration;
            const pendingAttachments: MessageItem[] = [];

            for await (const message of stream.messages) {
                const text = await message.text;
                const usage = await message.usage;
                if (text.length > 0 && message.node !== "contentFilter") {
                    if (isFirstText && pendingDeco) {
                        const decorated: MessageItem[] = [];
                        if (pendingDeco.reply) decorated.push({ type: "reply", data: pendingDeco.reply });
                        if (pendingDeco.at) for (const uid of pendingDeco.at) decorated.push({ type: "at", data: uid });
                        decorated.push({ type: "text", data: text });
                        session.message(decorated);
                        isFirstText = false;
                        if (pendingDeco.image) for (const fid of pendingDeco.image) pendingAttachments.push({ type: "image", data: fid });
                        if (pendingDeco.file) for (const fid of pendingDeco.file) pendingAttachments.push({ type: "file", data: fid });
                    } else {
                        session.message([{ type: "text", data: text }]);
                    }
                }
                if (usage) {
                    const u = usage as Record<string, any>;
                    logger.info("[LLM] in=" + (u.input_tokens ?? 0) + " cache=" + (u.input_token_details?.cache_read ?? 0) + " out=" + (u.output_tokens ?? 0) + " total=" + (u.total_tokens ?? 0));
                }
            }
            if (pendingAttachments.length > 0) session.message(pendingAttachments);
        } catch (error) {
            logger.error(`[${this.config.name}] error: ${error}`);
            session.message([{ type: "text", data: "处理消息时出现错误，请稍后重试。" }]);
        }
    }

    async compactThread(threadId: string, keepLast?: number) {
        return compactThread(this.app, threadId, keepLast);
    }

    getGraph() { return this.app; }
}
