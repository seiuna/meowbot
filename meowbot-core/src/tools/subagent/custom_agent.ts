import { Annotation, StateGraph } from "@langchain/langgraph";
import type { CompiledStateGraph } from "@langchain/langgraph";
import { SystemMessage, HumanMessage, AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { RunnableConfig } from "@langchain/core/runnables";
import { BaseAgent } from "../../agent/types.js";
import { checkpointer } from "../../agent/checkpointer.js";
import { messageValidatorNode } from "../../agent/message_validator.js";
import { modelRegistry } from "@meowbot/llm";
import { getLogger } from "@meowbot/utils/logs";
import type { SessionContext, SessionType } from "@meowbot/gateway/index.types";
import { NotificationTargetModel } from "../../social/notification_target.js";

const logger = getLogger("CustomAgent");

const DEFAULT_MAX_ITERATIONS = 15;

export interface CustomAgentResult {
    output: string;
    iterations: number;
    toolsUsed: string[];
    threadId: string;
}

const SubState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (a, b) => a.concat(b),
        default: () => [],
    }),
    iteration: Annotation<number>({
        reducer: (_old, val) => val,
        default: () => 0,
    }),
    maxIterations: Annotation<number>({
        reducer: (_old, val) => val,
        default: () => DEFAULT_MAX_ITERATIONS,
    }),
});

export class CustomAgent extends BaseAgent {
    private graph: CompiledStateGraph<typeof SubState.State, any, any>;
    private systemPrompt: string;
    private tools: DynamicStructuredTool[];
    private maxIterations: number;

    constructor(
        name: string,
        systemPrompt: string,
        tools: DynamicStructuredTool[],
        maxIterations?: number,
    ) {
        super(name, "Sub-agent: " + name);
        this.systemPrompt = systemPrompt;
        this.tools = tools;
        this.maxIterations = maxIterations ?? DEFAULT_MAX_ITERATIONS;
        this.graph = this.buildGraph();
    }

    getGraph(): CompiledStateGraph<typeof SubState.State, any, any> {
        return this.graph;
    }

    private buildGraph() {
        return new StateGraph(SubState)
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

    private async executorNode(
        state: typeof SubState.State,
        _config: RunnableConfig,
    ): Promise<Partial<typeof SubState.State>> {
        const model = modelRegistry.getModel("executor").bindTools(this.tools);

        const it = state.iteration + 1;
        logger.info(
            "[CustomAgent:" + this.name + "] iteration " + it +
            "/" + this.maxIterations + " messages=" + state.messages.length,
        );

        const response = await model.invoke(state.messages);
        return { messages: [response], iteration: it };
    }

    private async toolsNode(
        state: typeof SubState.State,
        _config: RunnableConfig,
    ): Promise<Partial<typeof SubState.State>> {
        const toolNode = new ToolNode(this.tools);
        const result = await toolNode.invoke(state);
        return result as Partial<typeof SubState.State>;
    }

    private routeAfterExecutor(state: typeof SubState.State): string {
        const lastMsg = state.messages[state.messages.length - 1];

        if (
            (lastMsg instanceof AIMessage || lastMsg instanceof AIMessageChunk) &&
            lastMsg.tool_calls &&
            lastMsg.tool_calls.length > 0
        ) {
            if (state.iteration >= this.maxIterations) {
                logger.warn(
                    "[CustomAgent:" + this.name + "] max iterations (" + this.maxIterations +
                    ") reached, forcing final",
                );
                return "__end__";
            }
            return "tools";
        }
        return "__end__";
    }

    protected async handleSession(_session: SessionContext<SessionType>): Promise<void> {
        throw new Error("CustomAgent.handleSession should not be called directly");
    }

    async run(userPrompt: string, recallThreadId?: string): Promise<CustomAgentResult> {
        const threadId = recallThreadId || ("sub-" + this.name + "-" + Date.now());

        const config = { configurable: { thread_id: threadId } };

        if (!recallThreadId) {
            // New thread: push system prompt + user message
            const initialState: Partial<typeof SubState.State> = {
                messages: [
                    new SystemMessage(this.systemPrompt),
                    new HumanMessage(userPrompt),
                ],
                maxIterations: this.maxIterations,
            };
            await this.graph.invoke(initialState, config);
        } else {
            // Recall: just push user message onto existing thread
            const existingState: Partial<typeof SubState.State> = {
                messages: [new HumanMessage(userPrompt)],
                maxIterations: this.maxIterations,
            };
            await this.graph.invoke(existingState, config);
        }

        // Read final state
        const finalState = await this.graph.getState(config);
        const msgs = (finalState.values?.messages ?? []) as BaseMessage[];
        const iter = (finalState.values?.iteration ?? 0) as number;

        const toolsUsed: string[] = [];
        for (const m of msgs) {
            if (m instanceof AIMessage && m.tool_calls) {
                for (const tc of m.tool_calls) {
                    if (!toolsUsed.includes(tc.name)) toolsUsed.push(tc.name);
                }
            }
        }

        let finalOutput = "";
        if (msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            finalOutput = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
        }

        return { output: finalOutput || "(no output)", iterations: iter, toolsUsed, threadId };
    }
}

/**
 * CustomAgent variant for scheduled tasks.
 * After execution completes, delivers the final output to notification targets.
 */
export class ScheduledCustomAgent extends CustomAgent {
    private notifyTargetIds: string[];
    private taskName: string;

    constructor(
        name: string,
        systemPrompt: string,
        tools: DynamicStructuredTool[],
        notifyTargetIds: string[],
        taskName: string,
        maxIterations?: number,
    ) {
        super(name, systemPrompt, tools, maxIterations);
        this.notifyTargetIds = notifyTargetIds;
        this.taskName = taskName;
    }

    async run(userPrompt: string): Promise<CustomAgentResult> {
        const result = await super.run(userPrompt);
        await this.deliverResult(result.output);
        return result;
    }

    private async deliverResult(content: string): Promise<void> {
        if (this.notifyTargetIds.length === 0) return;

        const targets = await NotificationTargetModel.find({
            _id: { $in: this.notifyTargetIds },
        }).lean();

        for (const t of targets) {
            try {
                const { messageGateway } = await import("../../gateway/index.js");
                const msg: any[] = [{ type: "text", data: "[" + this.taskName + "]\n" + content }];
                messageGateway.notify(t.adapterName, t.publicId, t.userId, msg);
                logger.info("[Scheduled] Notified " + t.name + " via " + t.adapterName);
            } catch (err: any) {
                logger.warn("[Scheduled] Delivery failed for " + t.name + ": " + (err.message ?? String(err)));
            }
        }
    }
}
