/**
 * Shell command execution tool.
 * Runs shell commands with a 20-second timeout.
 * Requires user confirmation before execution (required: true).
 */

import { z } from "zod";
import { exec } from "node:child_process";
import { defineEnvToolWithThought } from "../tools.js";

const SHELL_TIMEOUT_MS = 20_000;

export const runShellTool = defineEnvToolWithThought(
    {
        name: "run_shell",
        description:
            "Execute a shell command on the host system and return its output. " +
            "The command times out after 20 seconds. **User confirmation is required** before execution. " +
            "Use this for: file operations, git commands, running scripts, package management, " +
            "system administration, or any shell-level task. " +
            "The command runs in the working directory of the bot process." +
            "当前系统语言为中文，请用中文描述命令给用户确认。",
        schema: z.object({
            command: z.string().describe("The shell command to execute, e.g. 'ls -la', 'git status', 'node script.js'"),
            description: z.string().optional().describe("Brief explanation of what this command does — helps the user decide whether to approve"),
        }),
    },
    async ({ command, description }) => {
        return new Promise<string>((resolve) => {
            const cmdDesc = description ? ` (${description})` : "";
            exec(command, { timeout: SHELL_TIMEOUT_MS }, (error, stdout, stderr) => {
                const result: Record<string, any> = {
                    command,
                    exit_code: error?.code ?? 0,
                    stdout: stdout || "",
                    stderr: stderr || "",
                };
                if (error) {
                    if (error.killed) {
                        result.error = `Command timed out after ${SHELL_TIMEOUT_MS / 1000}s`;
                    } else {
                        result.error = error.message;
                    }
                }
                // Truncate output to prevent token overflow
                if (result.stdout.length > 5000) {
                    result.stdout = result.stdout.substring(0, 5000) + "\n... (truncated)";
                }
                if (result.stderr.length > 2000) {
                    result.stderr = result.stderr.substring(0, 2000) + "\n... (truncated)";
                }
                resolve(JSON.stringify({ ok: !error || error.code === 0, ...result }));
            });
        });
    },
    { required: true, perms: ["tools.shell"], isEnabled: true },
);
