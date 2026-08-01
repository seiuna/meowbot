import { Annotation, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import type { CompiledStateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BaseAgent } from "../types";
import { SessionContext, SessionType } from "@meowbot/gateway/index.types";
import { modelRegistry } from "@meowbot/llm";
import { getLogger } from "@meowbot/utils/logs";
import { checkpointer } from "../checkpointer";
import { Prompts, SkillRegistry, Skill } from "@meowbot/template/prompts";
import { compactThread } from "../thread_manager.js";
import { messageValidatorNode } from "../message_validator.js";
import { DynamicStructuredTool, DynamicTool } from "@langchain/core/tools";
import { type PendingDecoration } from "../../tools/other/tools_other.js";
import type { MessageItem } from "@meowbot/gateway/adapters/types";

const logger = getLogger("DefaultAgent");

// ── State Definition ──
export const BaseState = Annotation.Root({
    ...MessagesAnnotation.spec,
    session: Annotation(),
    filtered: Annotation<boolean>({
        reducer: (_old, newValue) => newValue,
        default: () => false,
    }),
    filteredMessage: Annotation<string | undefined>({
        reducer: (_old, newValue) => newValue,
        default: () => undefined,
    }),
});
const AgentState = Annotation.Root({
    ...BaseState.spec
});



// ── Default Agent ──

export class DefaultAgent extends BaseAgent {
    private app: CompiledStateGraph<typeof AgentState.State, any, any>;
    /** Content filter cache: content hash → blocked boolean. TTL-based. */
    private filterCache: Map<string, { blocked: boolean; at: number }> = new Map();
    /** Cached agent-system skill (resolved once, reloaded on SkillRegistry.reload). */
    private skillCache: { skill: Skill; prompt: string; fewshot: () => BaseMessage[] } | null = null;

    constructor() {
        // No hardcoded tool providers — tools come from the agent-system skill.
        super("default-agent", "A default agent for handling basic sessions.", []);
        this.app = this.buildGraph();
    }

    /** Resolve the agent-system skill and cache the skill + prompt. */
    private async resolveSkill(): Promise<{ skill: Skill; prompt: string; fewshot: () => BaseMessage[] }> {
        if (!this.skillCache) {
            const skill = await SkillRegistry.get("agent-system");
            if (!skill) {
                throw new Error(
                    `DefaultAgent requires the "agent-system" skill but it was not found. ` +
                    `Ensure skills/agent-system/ exists with skill.md and info.json.`
                );
            }
            if (!(skill instanceof Skill)) {
                throw new Error(`The "agent-system" skill must be a tool-providing Skill, got category "${skill.meta.category}".`);
            }
            this.skillCache = {
                skill,
                prompt: skill.prompt(),
                fewshot: () => skill.fewshot(),
            };
        }
        return this.skillCache;
    }

    /**
     * Build the LangGraph StateGraph with tools support
     */
    private buildGraph() {
        return new StateGraph(AgentState)
            .addNode("messageValidator", messageValidatorNode)
            .addNode("executor", this.executorNode.bind(this))
            .addNode("tools", this.toolsNode.bind(this))
            .addEdge("__start__", "messageValidator")
            .addEdge("messageValidator", "executor")
            .addConditionalEdges("executor", this.routeAfterExecutor.bind(this), {
                tools: "tools",
                __end__: "__end__",
            })
            .addEdge("tools", "executor")
            .compile({ checkpointer: checkpointer.mongoCheckpointer });
    }

    /**
     * Content filter node — uses LLM (compactor model) to classify the latest user message.
     * If classified as BLOCK, sets filtered=true so the graph ends immediately.
     */
    private async contentFilterNode(
        state: typeof AgentState.State,
        _config: RunnableConfig
    ): Promise<Partial<typeof AgentState.State>> {
        // Check bypass permission
        const session: SessionContext<SessionType> | undefined = (_config as any)?.configurable?.session;
        // if (session) {
        //     try {
        //         const { getPermissionService } = await import("../../permission/index.js");
        //         if (await getPermissionService().isAllowed(session.event.userId, "user.bypass")) {
        //             return { filtered: false, filteredMessage: undefined };
        //         }
        //     } catch {}
        // }

        const lastMessage = state.messages[state.messages.length - 1];
        const content = typeof lastMessage.content === "string"
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);

        // Skip empty messages and system messages
        if (!content || lastMessage instanceof SystemMessage || lastMessage instanceof AIMessage) {
            return { filtered: false, filteredMessage: undefined };
        }

        // Normalize & hash for cache key
        const key = content.trim().substring(0, 200).toLowerCase();

        // Check cache (TTL: 10 minutes)
        const cached = this.filterCache.get(key);
        if (cached && (Date.now() - cached.at) < 10 * 60 * 1000) {
            logger.info("[ContentFilter] cache " + (cached.blocked ? "BLOCK" : "PASS") + " (hit)");
            if (cached.blocked) {
                state.messages.pop();
                return { filtered: true, filteredMessage: "前面的话题以后再聊吧" };
            }
            return { filtered: false, filteredMessage: undefined };
        }

        try {
            const skill = await SkillRegistry.get("content-filter");
            const model = modelRegistry.getModel("filter");
            const response = await model.invoke([
                new SystemMessage(skill?.prompt() || "Reply only BLOCK or PASS."),
                new HumanMessage(content),
            ]);

            const rawContent = response.content;
            const verdict = typeof rawContent === "string"
                ? rawContent
                : (Array.isArray(rawContent) && rawContent.length > 0
                    ? (rawContent[0] as any).text ?? ""
                    : "");
            logger.info("[ContentFilter] verdict: " + verdict + " for: " + content.substring(0, 80));

            const blocked = verdict === "BLOCK";

            // Store in cache
            this.filterCache.set(key, { blocked, at: Date.now() });

            // Periodic cleanup: evict entries older than 15 min
            if (this.filterCache.size > 500) {
                const cutoff = Date.now() - 15 * 60 * 1000;
                for (const [k, v] of this.filterCache) {
                    if (v.at < cutoff) this.filterCache.delete(k);
                }
            }

            if (blocked) {
                state.messages.pop();
                return { filtered: true, filteredMessage: "前面的话题以后再聊吧" };
            }
        } catch (err: any) {
            logger.warn("[ContentFilter] LLM call failed, defaulting to PASS: " + (err.message ?? String(err)));
        }

        return { filtered: false, filteredMessage: undefined };
    }

    /**
     * Route after content filter
     */
    private routeAfterFilter(state: typeof AgentState.State): string {
        if (state.filtered) {
            return "__end__";
        }
        return "executor";
    }

    /**
     * Executor node - calls LLM to generate response
     */
    private async executorNode(
        state: typeof AgentState.State,
        config: RunnableConfig
    ): Promise<Partial<typeof AgentState.State>> {
        const skill = await this.resolveSkill();
        const model = modelRegistry.getModel("executor").bindTools(skill.skill.tools());

        const messages = [
            new SystemMessage(skill.prompt),
            ...skill.fewshot(),
            ...state.messages,
        ];

        const response = await model.invoke(messages, config);

        return {
            messages: [response],
        };
    }

    /**
     * Tools node — executes tool calls using skill-defined tools.
     */
    private async toolsNode(
        state: typeof AgentState.State,
        config: RunnableConfig
    ): Promise<Partial<typeof AgentState.State>> {
        const skill = await this.resolveSkill();
        // Resolve tools at call time so providers registered after startup are included.
        const toolNode = new ToolNode(skill.skill.tools());
        const result = await toolNode.invoke(state, config);
        return result;
    }

    /**
     * Route after executor - check if tool calls exist
     */
    private routeAfterExecutor(state: typeof AgentState.State): string {
        const lastMessage = state.messages[state.messages.length - 1];

        if (
            (lastMessage instanceof AIMessage || lastMessage instanceof AIMessageChunk) &&
            lastMessage.tool_calls &&
            lastMessage.tool_calls.length > 0
        ) {
            return "tools";
        }

        return "__end__";
    }

    /**
     * Handle session - build message and invoke graph
     */
    protected async handleSession(session: SessionContext<SessionType>): Promise<void> {
        logger.info("DefaultAgent handling session: " + session.sessionId);

        try {
            const userMessage = await this.buildIncomeMessage(session);
            const config = {
                configurable: {
                    thread_id: session.threadId,
                    session: session,
                },
            };
            const stream = await this.app.streamEvents({ messages: [userMessage] }, { ...config, version: "v3" });

            for await (const message of stream.messages) {
                const text = await message.text;
                const usage = await message.usage;
                if (text.length > 0) {
                    const pendingDeco = (session as any).pendingDecoration as PendingDecoration | null;
                    if (pendingDeco) {
                        delete (session as any).pendingDecoration;
                    }
                    const pendingAttachments: MessageItem[] = [];

                    if (pendingDeco) {
                        // Build decorated first message: [reply?, at..., text]
                        const decorated: MessageItem[] = [];
                        if (pendingDeco.reply) {
                            decorated.push({ type: "reply", data: pendingDeco.reply });
                        }
                        if (pendingDeco.at && pendingDeco.at.length > 0) {
                            for (const uid of pendingDeco.at) {
                                decorated.push({ type: "at", data: uid });
                            }
                        }
                        decorated.push({ type: "text", data: text });
                        session.message(decorated);

                        // Collect file/image for after the loop
                        if (pendingDeco.image && pendingDeco.image.length > 0) {
                            for (const fid of pendingDeco.image) {
                                pendingAttachments.push({ type: "image", data: fid });
                            }
                        }
                        if (pendingDeco.file && pendingDeco.file.length > 0) {
                            for (const fid of pendingDeco.file) {
                                pendingAttachments.push({ type: "file", data: fid });
                            }
                        }
                        if (pendingAttachments.length > 0) {
                            session.message(pendingAttachments);
                        }
                    } else {
                        session.message([{ type: "text", data: text }]);
                    }
                }
                if (usage) {
                    const u = usage as Record<string, any>;
                    const cache = u.input_token_details?.cache_read ?? 0;
                    const reasoning = u.output_token_details?.reasoning ?? 0;
                    const parts: string[] = [];
                    parts.push("in=" + (u.input_tokens ?? 0));
                    if (cache) parts.push("cache=" + cache);
                    parts.push("out=" + (u.output_tokens ?? 0));
                    if (reasoning) parts.push("reasoning=" + reasoning);
                    parts.push("total=" + (u.total_tokens ?? 0));
                    logger.info("[LLM] " + parts.join(" "));
                }
            }

    

            const finalState = await this.app.getState(config);
            if ((finalState.values as any)?.filtered) {
                session.message([{ type: "text", data: "前面的话题以后再聊吧" }]);
            }
        } catch (error) {
            logger.error("DefaultAgent error: " + error);
            session.message([{ type: "text", data: "处理消息时出现错误，请稍后重试。" }]);
        }
    }

    // ── Thread management ──

    /** Compact the conversation history for a thread. Returns summary stats. */
    async compactThread(threadId: string, keepLast?: number) {
        return compactThread(this.app, threadId, keepLast);
    }

    /** Get the compiled graph. */
    getGraph() {
        return this.app;
    }
}
