import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { defineEnvToolWithThought } from "@meowbot/tools/tools";
import { IToolProvider } from "@meowbot/tools/tool_registry";
import { NotificationTargetModel } from "../../social/notification_target.js";

// ── list_notify_targets ──

const listNotifyTargetsTool = defineEnvToolWithThought(
    {
        name: "list_notify_targets",
        description:
            "List all notification targets for the current user. " +
            "Returns target IDs that can be used as notify_target_ids in schedule_subagent. " +
            "Use this before creating a scheduled task to know which channels the user has set up.",
        schema: z.object({}),
    },
    async (_, runConfig) => {
        const session = (runConfig?.configurable as any)?.session;
        const event = session?.event;
        if (!event) return JSON.stringify({ ok: false, error: "No session context" });

        const publicId = event.extra?.groupId ?? event.groupId ?? event.userId;
        const targets = await NotificationTargetModel.find({ publicId }).lean();
        const data = targets.map(t => ({
            id: t._id.toString(),
            name: t.name,
            adapter: t.adapterName,
        }));

        return JSON.stringify({ ok: true, count: data.length, targets: data });
    },
);

// ── ToolProvider ──

export class NotificationToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [listNotifyTargetsTool];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "Notification";
    }

    getDescription(): string {
        return "Notification target tools — list saved notification targets";
    }
}
