/**
 * Command tools — allows LLM to list and call chat commands on behalf of the user.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { defineEnvToolWithThought as defineTool, type ToolRunConfig } from "@meowbot/tools/tools.js";
import { IToolProvider } from "@meowbot/tools/tool_registry.js";
import { commandRegistry } from "@meowbot/command/dispatcher.js";
import type { CmdResult } from "@meowbot/command/command.js";
import { getLogger } from "@meowbot/utils/logs.js";

const logger = getLogger("CommandTools");

// ── list_commands ──

const listCommandsTool = defineTool(
    {
        name: "list_commands",
        description: "List all available chat commands (e.g. /system session dump, /notify create). Returns command name and description.",
        schema: z.object({
            keyword: z.string().optional().describe("Optional search keyword — only commands matching name or description are returned"),
        }),
    },
    async (input, config) => {
        const roots = commandRegistry.getRootCommands();
        const lines: string[] = [];

        for (const [name, cmd] of roots) {
            const helpText = cmd.getHelp();
            const descMatch = helpText.match(/\/\S+ - (.+)/);
            const desc = descMatch ? descMatch[1] : "(no description)";

            if (input.keyword) {
                const kw = input.keyword.toLowerCase();
                if (!name.toLowerCase().includes(kw) && !desc.toLowerCase().includes(kw)) {
                    continue;
                }
            }

            lines.push(`/${name} — ${desc}`);
        }

        if (lines.length === 0) {
            return input.keyword
                ? `No commands matching "${input.keyword}".`
                : "No commands available.";
        }

        return `Available commands (${lines.length}):\n\n` + lines.join("\n");
    },
    { perms: ["tools.command"], isEnabled: true, required: false },
);

// ── call_command ──

const callCommandTool = defineTool(
    {
        name: "call_command",
        description: "Call a chat command on behalf of the current user. Use list_commands first to see available commands, then call the right one.",
        schema: z.object({
            command: z.string().describe("The command to execute, without the / prefix. e.g. 'system session dump' or 'notify create DailyReport'"),
        }),
    },
    async (input, config) => {
        const sessionCtx = (config as ToolRunConfig)?.configurable?.session;
        if (!sessionCtx) {
            return JSON.stringify({ ok: false, error: "No session context available" });
        }

        // We need a SessionContext<"command">, but we have SessionContext<"message">
        // Create a minimal command session by cloning the relevant parts
        const commandCtx = {
            ...sessionCtx,
            sessionType: "command" as const,
            getAdapter: () => sessionCtx.getAdapter(),
        } as any;

        try {
            const result = await commandRegistry.execute(input.command.trim(), commandCtx);

            // Check for CmdResult
            if (result && typeof result === "object" && "ok" in result) {
                const cr = result as CmdResult;
                return JSON.stringify({
                    ok: cr.ok,
                    type: cr.type ?? null,
                    message: cr.message,
                });
            }

            // String result (backward compat)
            if (typeof result === "string") {
                return JSON.stringify({ ok: true, type: null, message: result });
            }

            return JSON.stringify({ ok: true, type: null, message: "Command executed." });
        } catch (error: any) {
            return JSON.stringify({ ok: false, error: error.message ?? String(error) });
        }
    },
    { perms: ["tools.command"], isEnabled: true, required: false },
);

// ── Provider ──

export class CommandToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [listCommandsTool, callCommandTool];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "Command";
    }

    getDescription(): string {
        return "Chat command execution tools — list and call registered commands";
    }
}
