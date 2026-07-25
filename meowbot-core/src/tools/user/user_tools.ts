import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { defineEnvToolWithThought } from "@meowbot/tools/tools";
import { IToolProvider } from "@meowbot/tools/tool_registry";
import { createSelectRequest } from "../../gateway/hitl.js";
import { getLogger } from "@meowbot/utils/logs";
import { SessionContext } from "@meowbot/gateway/index.types.js";
import { MessageData } from "@meowbot/gateway/adapters/types.js";

const logger = getLogger("UserIntervention");

// ── ask_user ──

const askUserTool = defineEnvToolWithThought(
    {
        name: "ask_user",
        description:
            "Ask the user a question with multiple-choice options. " +
            "Use this when you need the user to make a decision or choose between alternatives. " +
            "Provide a clear question and 2-5 options with short labels. " +
            "The user's selection will be returned. DO NOT use this for simple yes/no — just present concrete options.",
        schema: z.object({
            question: z.string().describe(
                "The question to ask the user. Be specific and clear."
            ),
            options: z.array(z.object({
                label: z.string().describe("Short display label for this option, e.g. 'test.ts'"),
                value: z.string().describe("Internal value for this option, e.g. 'test.ts'"),
                description: z.string().optional().describe("Optional longer description"),
            })).min(2).max(5).describe(
                "List of options to present to the user. 2-5 options."
            )
           
        }),
    },
    async (input, runConfig) => {
        const session = (runConfig?.configurable as any)?.session as SessionContext<"message">;

        try {
            const response = await session.wait(createSelectRequest(
                input.question,
                input.options.map(opt => ({
                    label: opt.label,
                    value: opt.value,
                    description: opt.description,
                })),
                { timeoutMs: 60 * 1000 },
            ));

            const r = response.result();
            if (!r.ok) {
                return JSON.stringify({
                    ok: false,
                    error: r.error
                        ? (r.error === "timeout"
                            ? "User did not respond in time (60s)"
                            : "User rejected")
                        : "User cancelled or response was invalid",
                });
            }

            return JSON.stringify({
                ok: true,
                selected: r.value,
                question: input.question,
            });
        } catch (err: any) {
            logger.warn("[ask_user] wait failed: " + (err.message ?? String(err)));
            return JSON.stringify({
                ok: false,
                error: "Failed to ask user: " + (err.message ?? String(err)),
            });
        }
    },
    { required: false },
);

// ── ToolProvider ──

export class UserInterventionToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [askUserTool];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "UserIntervention";
    }

    getDescription(): string {
        return "User interaction tools — ask the user to make a choice";
    }
}
