/**
 * Dynamic tool access — search_tools + call_tools
 *
 * Every agent starts with only essential tools (from AGENT.md).
 * These two tools let agents discover and invoke ANY registered tool at runtime.
 *
 * search_tools(query, provider?) → list matching tools with name + description
 * call_tools(name, args)         → invoke a specific tool by name
 */

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { defineEnvToolWithThought } from "./tools.js";
import { toolRegistry, IToolProvider } from "./tool_registry.js";

// ── Schema extraction ──

/** Convert a Zod schema to a minimal JSON Schema object.
 *  Uses duck-typing on _def.typeName instead of instanceof to work across Zod versions
 *  (LangChain uses Zod v3 internally, project uses Zod v4).
 */
function toJsonSchema(zodType: z.ZodTypeAny): Record<string, any> {
    const def = (zodType as any)._def;
    const getDesc = () => def?.description ?? (zodType as any).description ?? "";
    const typeName = def?.typeName ?? "";

    // Unwrap optional/default
    if (typeName === "ZodOptional" || typeName === "ZodDefault") {
        return toJsonSchema(def?.innerType ?? zodType);
    }

    switch (typeName) {
        case "ZodString":
            return { type: "string", ...(getDesc() ? { description: getDesc() } : {}) };

        case "ZodNumber":
        case "ZodInt": {
            const checks = def?.checks ?? [];
            const min = checks.find((c: any) => c.kind === "min")?.value;
            const max = checks.find((c: any) => c.kind === "max")?.value;
            return {
                type: typeName === "ZodInt" ? "integer" : "number",
                ...(min != null ? { minimum: min } : {}),
                ...(max != null ? { maximum: max } : {}),
                ...(getDesc() ? { description: getDesc() } : {}),
            };
        }

        case "ZodBoolean":
            return { type: "boolean", ...(getDesc() ? { description: getDesc() } : {}) };

        case "ZodArray": {
            const itemType = def?.type;
            return {
                type: "array",
                items: itemType ? toJsonSchema(itemType) : {},
                ...(getDesc() ? { description: getDesc() } : {}),
            };
        }

        case "ZodObject": {
            const shape = def?.shape() ?? def?.shape ?? {};
            const properties: Record<string, any> = {};
            const required: string[] = [];
            for (const [key, val] of Object.entries(shape)) {
                const valDef = (val as any)._def;
                const valType = valDef?.typeName ?? "";
                properties[key] = toJsonSchema(val as z.ZodTypeAny);
                if (valType !== "ZodOptional" && valType !== "ZodDefault") {
                    required.push(key);
                }
            }
            const result: Record<string, any> = { type: "object", properties };
            if (required.length > 0) result.required = required;
            if (getDesc()) result.description = getDesc();
            return result;
        }

        case "ZodEnum": {
            return {
                type: "string",
                enum: def?.values ?? [],
                ...(getDesc() ? { description: getDesc() } : {}),
            };
        }

        default:
            return { ...(getDesc() ? { description: getDesc() } : {}) };
    }
}

// ── search_tools ──

export const searchToolsTool = defineEnvToolWithThought(
    {
        name: "search_tools",
        description:
            "Search ALL registered tools by name or description. " +
            "Returns matching tools with their name, description, and provider. " +
            "Use this to discover tools you need but don't have yet. " +
            "Then use call_tools(name, args) to invoke any discovered tool.",
        schema: z.object({
            query: z.string().describe("Search keyword to match against tool name or description"),
            provider: z.string().optional().describe("Limit to this provider name (omit to search all)"),
        }),
    },
    async ({ query, provider }) => {
        try {
            const results = toolRegistry.searchTools(query);
            let filtered = results;
            if (provider) {
                const providerMap = new Map<string, string>();
                for (const p of toolRegistry.getProviders()) {
                    for (const t of p.pullAllTools()) {
                        if (!providerMap.has(t.name)) providerMap.set(t.name, p.getName());
                    }
                }
                filtered = results.filter(t => providerMap.get(t.name) === provider);
            }

            const data = filtered.map(t => ({
                name: t.name,
                description: t.description?.substring(0, 200) ?? "",
                provider: (() => {
                    for (const p of toolRegistry.getProviders()) {
                        if (p.pullAllTools().some(x => x.name === t.name)) return p.getName();
                    }
                    return "unknown";
                })(),
                schema: (() => {
                    try {
                        const s = (t as any).schema as z.ZodTypeAny;
                        return s ? toJsonSchema(s) : {};
                    } catch { return {}; }
                })(),
            }));

            return JSON.stringify({ ok: true, query, count: data.length, tools: data });
        } catch (error: any) {
            return JSON.stringify({ ok: false, error: error.message });
        }
    },
);

// ── call_tools ──

export const callToolsTool = defineEnvToolWithThought(
    {
        name: "call_tools",
        description:
            "Invoke ANY registered tool by its exact name. " +
            "Use search_tools first to find the tool name, then call it here. " +
            "Pass the tool's arguments as a JSON object in the `args` field. " +
            "This gives you access to ALL tools in the system — workspace, sub-agent, MCP, everything.",
        schema: z.object({
            name: z.string().describe("Exact tool name from search_tools results"),
            args: z.record(z.string(), z.any()).describe("Tool arguments as key-value pairs, e.g. { \"workspace_id\": \"meowbot\", \"file_path\": \"note.md\" }"),
        }),
    },
    async ({ name, args }, runConfig) => {
        try {
            const allTools = toolRegistry.getAllTools();
            const tool = allTools.find(t => t.name === name);
            if (!tool) {
                return JSON.stringify({ ok: false, error: `Tool "${name}" not found. Use search_tools to find available tools.` });
            }
            const result = await tool.invoke(args, runConfig);
            return typeof result === "string" ? result : JSON.stringify(result);
        } catch (error: any) {
            return JSON.stringify({ ok: false, error: `call_tools failed: ${error.message}` });
        }
    },
);

// ── Provider ──

export class DynamicToolsProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [searchToolsTool, callToolsTool];
    }

    pullAllTools(): DynamicStructuredTool[] { return this.tools; }
    getName(): string { return "Dynamic"; }
    getDescription(): string { return "Dynamic tool access — search and invoke any registered tool"; }
}
