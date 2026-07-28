import { tool, DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { getLogger } from "@meowbot/utils/logs";
import { estimateTokens, estimateToolPayloadTokens } from "@meowbot/utils/token_estimator";
import { createConfirmRequest, type SessionContext, type SessionType } from "@meowbot/gateway/index.types";

export type Environment = "qq_private" | "qq_group" | "console" | "system" | "all";

// ── Tool metadata config ──

export interface ToolPermsConfig {
    /** Required permission path(s) — checked at runtime before handler executes */
    perms?: string[];
    /** Whether the tool is enabled (default: true). Disabled tools are excluded from tool lists. */
    isEnabled?: boolean;
    /** Whether this tool requires user intervention/confirmation before execution */
    required?: boolean;
}

/**
 * Typed wrapper around LangChain RunnableConfig for tool execution context.
 * Replaces the pervasive `(config as any)?.configurable?.session` pattern.
 */
export interface ToolRunConfig extends RunnableConfig {
    configurable?: {
        session?: SessionContext<SessionType>;
        thread_id?: string;
    };
}

// ── EnvTool (metadata carrier) ──

export abstract class EnvTool extends DynamicStructuredTool {
    abstract perms?: string[];
    abstract isEnabled: boolean;
    abstract required: boolean;
}

const logger = getLogger("ToolCaller");

export type ThoughtHook = (
    toolName: string,
    thought: string,
    inputs: unknown,
    config?: ToolRunConfig
) => void;

let globalThoughtHook: ThoughtHook = (name, _thought, inputs, config) => {
    const session = config?.configurable?.session;
    const inputsStr = typeof inputs === "object" ? JSON.stringify(inputs) : String(inputs);
    logger.info(`[${session?.threadId}] ${name}(${inputsStr})`);
};

/**
 * Create a structured tool with thought-stripping, token estimation,
 * logging, and optional permission checks.
 *
 * @param config       - Tool name, description, and Zod schema
 * @param handler      - Async handler (receives parsed input + ToolRunConfig)
 * @param toolConfig   - Optional: perms (permission paths), isEnabled, required
 */
export function defineEnvToolWithThought<T extends z.ZodObject<any>>(
    config: { name: string; description: string; schema: T },
    handler: (input: z.infer<T>, config?: ToolRunConfig) => Promise<string>,
    toolConfig?: ToolPermsConfig,
): EnvTool {
    const baseTool = tool(
        async (input, runConfig) => {

            const { thought, ...rest } = input;

            if (globalThoughtHook) {
                globalThoughtHook(config.name, thought as string, rest, runConfig as ToolRunConfig);
            }

            const sessionContext = (runConfig as ToolRunConfig)?.configurable?.session;
            const sid = sessionContext?.threadId;

            logger.info(`[tool:${config.name}] session=${sid} args=${JSON.stringify(rest)}`);

            // ── Permission check ──
            if (toolConfig?.perms && toolConfig.perms.length > 0) {
                for (const perm of toolConfig.perms) {
                    if (!(await sessionContext?.isAllowed(perm))) {
                        const msg = `Permission denied: ${config.name} requires "${perm}"`;
                        logger.warn(`[tool:${config.name}] ${msg} (user: ${sessionContext?.event?.userId})`);
                        return JSON.stringify({ ok: false, error: msg });
                    }
                }
            }

            // User confirmation: only ask when required is explicitly true
            if (toolConfig?.required === true) {
                if (!sessionContext) {
                    return JSON.stringify({ ok: false, error: "Cannot confirm: no session context" });
                }
                const response = await sessionContext.wait(createConfirmRequest(
                    "The Agent wants to execute this operation:\nTool: " + config.name + "\n" + JSON.stringify(rest),
                    { timeoutMs: 1000 * 20 }
                ));
                if (response?.type !== "confirm" || !response.confirmed) {
                    return JSON.stringify({ ok: false, error: "User declined the operation" });
                }
            }

            try {
                const result = await handler(input as z.infer<T>, runConfig as ToolRunConfig);
                const outTokens = estimateTokens(result);

                const preview = result.length > 500
                    ? result.substring(0, 500) + "..."
                    : result;
                logger.info(`[tool:${config.name}] OK session=${sid} tokens_out=${outTokens}`);
                logger.info(`[tool:${config.name}] result: ${preview}`);

                return result;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const stack = error instanceof Error ? error.stack : "";
                logger.error(`[tool:${config.name}] FAIL session=${sid} error=${errorMessage}`);
                if (stack) logger.error(`[tool:${config.name}] stack: ${stack}`);
                throw error;
            }
        },
        {
            ...config,
            schema: config.schema
        }
    );

    (baseTool as unknown as EnvTool).perms = toolConfig?.perms;
    (baseTool as unknown as EnvTool).isEnabled = toolConfig?.isEnabled ?? true;
    (baseTool as unknown as EnvTool).required = toolConfig?.required ?? false;
    return baseTool as unknown as EnvTool;
}

/**
 * Wrap an existing DynamicStructuredTool (e.g. from MCP) with the same
 * thought-stripping, logging, and permission layer as defineEnvToolWithThought.
 *
 * @param tool         - Existing tool to wrap
 * @param toolConfig   - Optional: perms, isEnabled, required
 */
/**
 * Convert a plain JSON Schema object to a Zod schema.
 * MCP tools provide their schema as JSON Schema, but defineEnvToolWithThought
 * expects a Zod schema. This bridges the gap.
 */
function jsonSchemaToZod(schema: Record<string, any>): z.ZodTypeAny {
    if (!schema || typeof schema !== "object") return z.any();

    const desc = schema.description;
    const type = schema.type;

    switch (type) {
        case "string": {
            if (schema.enum) {
                const e = z.enum(schema.enum as [string, ...string[]]);
                return desc ? e.describe(desc) : e;
            }
            const s = z.string();
            return desc ? s.describe(desc) : s;
        }
        case "number":
        case "integer": {
            let s = type === "integer" ? z.number().int() : z.number();
            if (schema.minimum != null) s = s.min(schema.minimum);
            if (schema.maximum != null) s = s.max(schema.maximum);
            return desc ? s.describe(desc) : s;
        }
        case "boolean":
            return desc ? z.boolean().describe(desc) : z.boolean();
        case "array": {
            const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.any();
            let s = z.array(itemSchema);
            return desc ? s.describe(desc) : s;
        }
        case "object": {
            if (!schema.properties) {
                const s = z.record(z.string(), z.any());
                return desc ? s.describe(desc) : s;
            }
            const shape: Record<string, z.ZodTypeAny> = {};
            const required = new Set<string>(schema.required ?? []);
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                let field = jsonSchemaToZod(propSchema as Record<string, any>);
                if (!required.has(key)) field = field.optional();
                shape[key] = field;
            }
            const s = z.object(shape);
            return desc ? s.describe(desc) : s;
        }
        default:
            return z.any();
    }
}

/** Check if a schema object is a plain JSON Schema (not a Zod schema). */
function isJsonSchemaObject(schema: unknown): schema is Record<string, any> {
    return (
        typeof schema === "object" &&
        schema !== null &&
        "type" in (schema as Record<string, any>) &&
        !("_def" in (schema as Record<string, any>))
    );
}

export function wrapToolWithThought(
    tool: DynamicStructuredTool,
    toolConfig?: ToolPermsConfig,
): EnvTool {
    // MCP tools provide their schema as JSON Schema; convert to Zod
    const rawSchema = (tool as any).schema;
    const zodSchema: z.ZodObject<any> = isJsonSchemaObject(rawSchema)
        ? jsonSchemaToZod(rawSchema) as z.ZodObject<any>
        : (rawSchema as z.ZodObject<any>) ?? z.object({}).passthrough();

    const wrapped = defineEnvToolWithThought(
        {
            name: tool.name,
            description: tool.description,
            schema: zodSchema,
        },
        async (input, runConfig) => {
            const result = await tool.invoke(input);
            return typeof result === "string" ? result : JSON.stringify(result);
        },
        toolConfig,
    );
    return wrapped;
}
