import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { defineEnvToolWithThought } from "./tools";
import { getAgenda } from "../scheduler/agenda.service";
import { IToolProvider } from "./tool_registry";
import { SkillRegistry } from "@meowbot/template/prompts";
import { ScreenshotManager } from "../image_generation/screenshot-manager.js";
import { BuilderSource } from "../image_generation/index.js";
import { Buffer } from "node:buffer";
import { getFileService } from "../files/index.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("ScheduledTools");

// ── 1. list_scheduled_tasks ──

const listScheduledTasksTool = defineEnvToolWithThought(
    {
        name: "list_scheduled_tasks",
        description:
            "List all scheduled tasks for the current conversation. " +
            "Returns task ID, name, interval, and next run time.",
        schema: z.object({}),
    },
    async (_, runConfig) => {
        const session = (runConfig?.configurable as any)?.session;
        const threadId = session?.originalSession?.threadId ?? "global";

        const agenda = await getAgenda();
        const result = await agenda.queryJobs({});
        const matched = result.jobs.filter((j: any) => {
            const d = j.data as any;
            return d?.threadId === threadId;
        });

        if (!matched.length) {
            return JSON.stringify({ ok: true, tasks: [], message: "No scheduled tasks." });
        }

        const tasks = matched.map((j: any) => {
            const d = j.data as any;
            return {
                id: j._id,
                name: d.taskName ?? "unnamed",
                interval: j.repeatInterval ?? "once",
                next_run: j.nextRunAt?.toISOString() ?? "unknown",
            };
        });

        return JSON.stringify({ ok: true, count: tasks.length, tasks });
    },
);

// ── 2. delete_scheduled_task ──

const deleteScheduledTaskTool = defineEnvToolWithThought(
    {
        name: "delete_scheduled_task",
        description: "Cancel and delete a scheduled task by its ID.",
        schema: z.object({
            task_id: z.string().describe("The task ID from list_scheduled_tasks"),
        }),
    },
    async (input) => {
        const agenda = await getAgenda();
        const result = await agenda.queryJobs({ id: input.task_id, limit: 1 });
        if (!result.jobs.length) {
            return JSON.stringify({ ok: false, error: "Task not found or already deleted." });
        }
        const data = result.jobs[0].data as any;
        const name = data.taskName || input.task_id;
        await agenda.cancel({ name });
        return JSON.stringify({ ok: true, deleted: name });
    },
);

// ── 3. schedule_subagent ──

const scheduleSubagentTool = defineEnvToolWithThought(
    {
        name: "schedule_subagent",
        description:
            "Schedule a sub-agent to run at a future time or on a recurring interval. " +
            "REQUIRES a skill_name (from search_prompts) and at least one notify_target_id. " +
            "When the schedule fires, a sub-agent will execute the task using the skill's prompt and tools. " +
            "Only the FINAL result is sent to notification targets.",
        schema: z.object({
            skill_name: z.string().describe("Skill name from search_prompts. The skill provides the system prompt AND tools."),
            user_prompt: z.string().describe("The task for the scheduled sub-agent to perform"),
            task_name: z.string().describe("Short label, e.g. 'Daily news digest'"),
            interval: z.string().describe("Schedule: '1 day', '5 minutes', or cron '0 8 * * *'"),
            notify_target_ids: z.array(z.string()).min(1).describe(
                "REQUIRED: At least one notification target ID. Get these from list_notify_targets."
            ),
        }),
    },
    async (input, runConfig) => {
        // Check user permission
        const session = (runConfig?.configurable as any)?.session;
        const userId = session?.event?.userId;
        if (userId) {
            const { getPermissionService } = await import("../permission/index.js");
            const allowed = await getPermissionService().requireAllowed(userId, "user.createtask");
            if (!allowed) {
                return JSON.stringify({
                    ok: false,
                    error: "Permission denied: user.createtask is required to create scheduled tasks.",
                });
            }
        }

        try {
            // Resolve skill for prompt + tools
            const skill = await SkillRegistry.get(input.skill_name);
            if (!skill) {
                return JSON.stringify({
                    ok: false,
                    error: `Skill "${input.skill_name}" not found. Use search_prompts to find available skills.`,
                });
            }
            const sp = skill.prompt();
            const toolProviderNames = skill.meta.requiredProviders;

            const session = (runConfig?.configurable as any)?.session;
            const threadId = session?.originalSession?.threadId ?? "global";

            const agenda = await getAgenda();
            const job = await agenda.every(input.interval, "agent_global_job", {
                threadId,
                taskName: input.task_name,
                systemPrompt: sp,
                userPrompt: input.user_prompt,
                toolProviders: toolProviderNames,
                notifyTargetIds: input.notify_target_ids,
            });

            const nextRun = job.attrs.nextRunAt?.toISOString() ?? "pending";

            // Generate card image
            if (session) {
                try {
                    const mgr = await ScreenshotManager.getInstance();
                    const page = await mgr.createPage();
                    try {
                        const source = BuilderSource.fromTemplate("schedule-card.html");
                        const png = await mgr.capture(page, source, {
                            name: "schedule-card",
                            elementId: "#screenshot-target",
                            data: {
                                icon: "\u23F0",
                                title: input.task_name,
                                task_prompt: input.user_prompt,
                                cron: input.interval,
                                tools: toolProviderNames,
                                footer: "Next: " + nextRun,
                            },
                        });
                        const dataUrl = "data:image/png;base64," + Buffer.from(png).toString("base64");
                        const fileId = getFileService().fromBase64(dataUrl, "schedule-card.png");
                        session.message([{ type: "image", data: fileId }]);
                    } finally {
                        await page.close().catch(() => {});
                    }
                } catch (err) {
                    logger.warn(`Card image generation failed: ${err}`);
                }
            }

            return JSON.stringify({
                ok: true,
                task_id: job.attrs._id,
                task_name: input.task_name,
                interval: input.interval,
                next_run: nextRun,
            });
        } catch (error: any) {
            return JSON.stringify({ ok: false, error: "Schedule failed: " + error.message });
        }
    },
);

// ── Tool Provider ──

const allScheduledTools: DynamicStructuredTool[] = [
    listScheduledTasksTool,
    deleteScheduledTaskTool,
    scheduleSubagentTool,
];

export class ScheduledToolProvider implements IToolProvider {
    getName(): string {
        return "ScheduledTools";
    }

    getDescription(): string {
        return "Scheduled task management — create, list, and delete scheduled sub-agents";
    }

    pullAllTools(): DynamicStructuredTool[] {
        return allScheduledTools;
    }
}
