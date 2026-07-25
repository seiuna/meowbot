import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { defineEnvToolWithThought, ToolRunConfig } from "@meowbot/tools/tools";
import { IToolProvider, toolRegistry } from "@meowbot/tools/tool_registry";
import { CustomAgent } from "./custom_agent.js";
import { agentRegistry } from "@meowbot/agent/agent_registry.js";

// ── Helper: resolve system prompt ──
// (kept for backward compat with schedule_subagent — prefer resolveSkillForSubagent)

export async function resolveSystemPrompt(
    _system_prompt: string | undefined,
    prompt_name: string | undefined,
): Promise<{ sp: string; source: string }> {
    if (!prompt_name) {
        throw new Error("prompt_name (prompt name) is required. Use search_prompts to find available prompts.");
    }
    const resolved = await resolveSkillForSubagent(prompt_name);
    return { sp: resolved.prompt, source: "prompt:" + prompt_name };
}

// ── Helper: build the full sub-agent system prompt ──

export function buildAgentSystemPrompt(raw: string): string {
    return (
        "<role>\n" +
        "You are a SUB-AGENT. You were spawned by a parent agent to handle a specific task. " +
        "You operate in an isolated context — you cannot access the parent's conversation history. " +
        "Work independently, use the tools available to you, and return a complete final answer. " +
        "Do NOT ask the user for clarification — infer what you need from the task description. " +
        "When finished, output your final result directly without calling any more tools.\n" +
        "</role>\n\n" +
        raw
    );
}

// ── Helper: resolve a sub-agent by name and extract prompt + tools ──

async function resolveSkillForSubagent(agentName: string): Promise<{
    prompt: string;
    tools: DynamicStructuredTool[];
}> {
    const agent = agentRegistry.getAgent(agentName);
    if (!agent) {
        throw new Error(`Agent "${agentName}" not found. Use search_prompts to find available agents.`);
    }
    const agentConfig = (agent as any).config;
    // Prompt is in AGENT.md body (after YAML frontmatter), stored in config.prompt
    const prompt = agentConfig?.prompt || agent.description;
    if (!prompt) throw new Error(`Agent "${agentName}" has no prompt content.`);
    // Tools: always include Workspace for sub-agents
    const workspaceTools = toolRegistry.getToolsForProviders(["Workspace"]).filter(
        t => (t as any).isEnabled !== false
    );
    // Add Dynamic tools for search/call
    const dynamicTools = toolRegistry.getToolsForProviders(["Dynamic"]).filter(
        t => (t as any).isEnabled !== false
    );
    const tools = [...dynamicTools, ...workspaceTools];
    // Deduplicate by tool name
    const seen = new Set<string>();
    const deduped: DynamicStructuredTool[] = [];
    for (const t of tools) {
        if (!seen.has(t.name)) {
            seen.add(t.name);
            deduped.push(t);
        }
    }
    return { prompt, tools: deduped };
}

// ── Helper: resolve tools, strip Subagent ──
// (kept for backward compat — prefer resolveSkillForSubagent)

export function resolveTools(tool_providers?: string[]): DynamicStructuredTool[] {
    if (!tool_providers || tool_providers.length === 0) {
        return [];
    }
    const safe = tool_providers.filter(p => p.toLowerCase() !== "subagent");
    return safe.length > 0 ? toolRegistry.getToolsForProviders(safe) : [];
}

// ── 1. search_prompts ──

const searchPromptsTool = defineEnvToolWithThought(
    {
        name: "search_prompts",
        description:
            "Search available sub-agents by name or description. " +
            "Only returns agents that can be used as sub-agents. " +
            "Use this to find a suitable agent for run_subagent.",
        schema: z.object({
            query: z.string().describe("Search keyword to match against agent names or descriptions"),
        }),
    },
    async ({ query }) => {
        try {
            const q = query.toLowerCase();
            const data: Array<{ name: string; description: string; preview: string; required_providers: string[] }> = [];

            for (const id of agentRegistry.list()) {
                const agent = agentRegistry.getAgent(id);
                if (!agent) continue;
                const agentConfig = (agent as any).config;
                // Only include agents marked as sub-agent capable
                if (!agentConfig?.as_sub_agent) continue;
                const matchName = agent.name.toLowerCase().includes(q);
                const matchDesc = (agent.description || "").toLowerCase().includes(q);
                if (!matchName && !matchDesc) continue;

                data.push({
                    name: agent.name,
                    description: agent.description || "",
                    preview: "",
                    required_providers: agentConfig?.tools || [],
                });
            }

            return JSON.stringify({ ok: true, query, count: data.length, prompts: data });
        } catch (error: any) {
            return JSON.stringify({ ok: false, error: "Failed to search prompts: " + error.message });
        }
    },
);

// ── 2. search_tool_providers ──

const searchToolProviders = defineEnvToolWithThought(
    {
        name: "search_tool_providers",
        description:
            "Search registered tool providers by name or description (fuzzy match). " +
            "Returns matching providers with their name, description, tool count, " +
            "and a list of individual tools. " +
            "Use this to discover what tool sets are available before searching for specific tools.",
        schema: z.object({
            query: z.string().describe("Search keyword to match against provider name or description"),
        }),
    },
    async ({ query }) => {
        try {
            const q = query.toLowerCase();
            const providers = toolRegistry.getProviders();

            const matched = providers.filter(p => {
                const name = (p.getName() ?? "").toLowerCase();
                const desc = (p.getDescription() ?? "").toLowerCase();
                return name.includes(q) || desc.includes(q);
            });

            if (matched.length === 0) {
                return JSON.stringify({
                    ok: true,
                    count: 0,
                    data: [],
                });
            }

            const data = matched.map(p => ({
                name: p.getName(),
                description: p.getDescription(),
                tool_count: p.pullAllTools().length,
                tools: p.pullAllTools().map(t => ({
                    name: t.name,
                    description: t.description,
                })),
            }));

            return JSON.stringify({
                ok: true,
                query,
                count: data.length,
                data,
            });
        } catch (error: any) {
            return JSON.stringify({
                ok: false,
                error: "Failed to search tool providers: " + error.message,
            });
        }
    },
);

// // ── 2. search_tools ──

// const searchToolsTool = defineEnvToolWithThought(
//     {
//         name: "search_tools",
//         description:
//             "Search all registered tools by name or description (fuzzy match). " +
//             "Optionally limit results to specific tool providers. " +
//             "Returns matching tools with their name and description. " +
//             "Use this to find specific tools by capability before calling run_subagent.",
//         schema: z.object({
//             query: z.string().describe("Search keyword to match against tool name or description"),
//             provider_names: z
//                 .array(z.string())
//                 .optional()
//                 .describe("Limit search to these provider names (omit to search all providers)"),
//         }),
//     },
//     async ({ query, provider_names }) => {
//         try {
//             const results = toolRegistry.searchTools(query);

//             let filtered = results;
//             if (provider_names && provider_names.length > 0) {
//                 // Determine which provider each tool belongs to
//                 const providerMap = new Map<string, string>();
//                 for (const p of toolRegistry.getProviders()) {
//                     for (const t of p.pullAllTools()) {
//                         if (!providerMap.has(t.name)) {
//                             providerMap.set(t.name, p.getName());
//                         }
//                     }
//                 }
//                 const nameSet = new Set(provider_names);
//                 filtered = results.filter(t => {
//                     const pn = providerMap.get(t.name) ?? "unknown";
//                     return nameSet.has(pn);
//                 });
//             }

//             if (filtered.length === 0) {
//                 return JSON.stringify({
//                     ok: true,
//                     count: 0,
//                     data: [],
//                 });
//             }

//             const data = filtered.map(t => ({
//                 name: t.name,
//                 description: t.description,
//             }));

//             return JSON.stringify({
//                 ok: true,
//                 query,
//                 count: data.length,
//                 data,
//             });
//         } catch (error: any) {
//             return JSON.stringify({
//                 ok: false,
//                 error: "Failed to search tools: " + error.message,
//             });
//         }
//     },
// );

// ── 4. run_subagent ──

const runSubagentTool = defineEnvToolWithThought(
    {
        name: "run_subagent",
        description:
            "Launch a sub-agent to handle complex multi-step tasks now. " +
            "REQUIRES a prompt name from search_prompts — the prompt determines the sub-agent's system prompt and available tools. " +
            "Each prompt always reuses the same sub-agent thread, so the sub-agent retains full conversation context across calls. " +
            "Workspace tools (file read/write/search) are automatically included.",
        schema: z.object({
            prompt_name: z.string().describe("Prompt name from search_prompts. The prompt provides the system prompt AND tools for the sub-agent."),
            user_prompt: z.string().describe("The specific task for the sub-agent to handle"),
            max_iterations: z.number().int().min(1).max(30).default(10).describe("Max iterations (default 10)"),
        }),
    },
    async (input,runConfig) => {
        try {
            const { prompt, tools } = await resolveSkillForSubagent(input.prompt_name);

            // Deterministic thread ID: same prompt = same sub-agent thread (persistent context)
            const threadId = "sub-"+ runConfig?.configurable?.thread_id + input.prompt_name;

            const agent = new CustomAgent(
                threadId,
                buildAgentSystemPrompt(prompt),
                tools,
                input.max_iterations,
            );
            // Always recall — the first call creates the thread, subsequent calls continue it
            const result = await agent.run(input.user_prompt, threadId);

            return JSON.stringify({
                ok: true,
                output: result.output,
                iterations: result.iterations,
                tools_used: result.toolsUsed,
            });
        } catch (error: any) {
            return JSON.stringify({ ok: false, error: "Sub-agent failed: " + error.message });
        }
    },
);

// ── ToolProvider ──

export class SubagentToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [searchPromptsTool, searchToolProviders, runSubagentTool];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "Subagent";
    }

    getDescription(): string {
        return "Sub-agent tools — search tool providers/tools, launch sub-agents for complex tasks";
    }
}
