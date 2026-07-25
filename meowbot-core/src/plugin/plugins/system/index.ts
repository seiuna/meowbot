import { Command } from "@meowbot/command/command.js";
import { Plugin, PluginContext } from "../../index.js";
import { Prompts } from "@meowbot/template/prompts";
import { SessionContext } from "@meowbot/gateway/index.js";
import { createSelectRequest } from "@meowbot/gateway/hitl.js";
import { getUserProfileManager } from "@meowbot/social/user_profile_manager.js";
import { agentRegistry } from "@meowbot/agent/agent_registry.js";
import { toolRegistry } from "@meowbot/tools/tool_registry.js";
import { loadMCPConfig, saveMCPConfig } from "@meowbot/mcp/index.js";
import type { MCPConfig, MCPServerConfig } from "@meowbot/mcp/index.js";
import { compactThread } from "@meowbot/agent/thread_manager.js";
import { DefaultAgent } from "@meowbot/agent/agents/default_agent.js";
import { TokenStore } from "@meowbot/llm/token_store.js";
import { NotificationTargetModel } from "@meowbot/social/notification_target.js";
import { randomUUID } from "crypto";

export default class SystemPlugin extends Plugin {
    name = "system";
    version = "1.0.0";
    description = "System plugin for session and agent management";

    async onLoad(): Promise<void> {
        // Plugin initialization logic here
    }

    async onInit(context: PluginContext): Promise<void> {
        const { commandRegistry } = context;

        // /system [sys] - 系统管理命令入口
        const systemCmd = commandRegistry.getOrCreate("system", ["sys"])
            .desc("系统管理命令")
            .require("admin.system");

        // /system info [i] - 系统运行信息
        systemCmd.literal("info", ["i"])
            .desc("系统运行信息 — token 用量统计、缓存命中率")
            .action(async () => {
                return this.handleSystemInfo();
            });

        // /system session [se] - Session 管理
        const sessionCmd = systemCmd.literal("session", ["se"])
            .desc("Session 管理");

        sessionCmd.literal("new")
            .desc("创建新的 session")
            .argument(Command.argument("name").default(""))
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleNewSession(ctx, args.name);
            });

        sessionCmd.literal("switch", ["sw"])
            .desc("选择一个 session，不带参数显示列表")
            .argument(Command.argument("session").default(""))
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleSelectSession(ctx, args.session);
            });

        sessionCmd.literal("delete", ["del", "rm"])
            .desc("删除指定 session")
            .argument(Command.argument("session").default(""))
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleDeleteSession(ctx, args.session);
            });

        sessionCmd.literal("list", ["ls"])
            .desc("显示当前 session 信息")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleSessionInfo(ctx);
            });

        // /system agent - Agent 管理
        const agentCmd = systemCmd.literal("agent")
            .desc("Agent 管理 — 查看、选择 agent");

        // /system agent list [ls] - 列出所有 agent
        agentCmd.literal("list", ["ls"])
            .desc("列出所有已注册的 agent")
            .action(async () => {
                return this.handleAgentList();
            });

        // /system agent info [i|show] [name] - 显示 agent 详细信息
        const agentInfoCmd = agentCmd.literal("info", ["i", "show"])
            .desc("显示 agent 的详细信息（工具、模型等），不指定 name 则显示默认 agent");

        agentInfoCmd.argument(Command.argument("name").default(""))
            .desc("agent 名称（可选，不填显示默认 agent）")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleAgentInfo(args.name);
            });

        // /system agent [name] - 选择 agent（fallback）
        agentCmd.argument(Command.argument("name").default(""))
            .desc("选择默认 agent，不带参数显示列表")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleSelectAgent(ctx, args.name);
            });

        // /system thread [th] - Thread 管理
        const threadCmd = systemCmd.literal("thread", ["th"])
            .desc("Thread 上下文管理 — 压缩或清除对话历史");

        threadCmd.literal("compact", ["cp"])
            .desc("压缩当前 thread 的对话上下文，保留关键信息并精简历史消息")
            .action(async (ctx: SessionContext<"command">) => {
                return this.handleThreadCompact(ctx);
            });

        threadCmd.literal("clear", ["cl"])
            .desc("清除当前 thread 的所有对话历史")
            .action(async (ctx: SessionContext<"command">) => {
                return this.handleThreadClear(ctx);
            });

        // /system template [tpl] - 模板管理
        const templateCmd = systemCmd.literal("template", ["tpl"])
            .desc("查看模板注册信息")
            .require("admin.template");

        templateCmd.literal("list", ["ls"])
            .desc("列出所有已注册的模板")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleTemplateList();
            });

        templateCmd.literal("display", ["show", "d"])
            .desc("显示指定模板的内容")
            .argument(Command.argument("id"))
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleTemplateDisplay(args.id);
            });

        templateCmd.literal("search", ["s", "find"])
            .desc("搜索模板")
            .argument(Command.argument("keyword"))
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleTemplateSearch(args.keyword);
            });

        // /system test — HITL 测试命令
        const testCmd = systemCmd.literal("test")
            .desc("HITL 测试命令")
            .require("admin.test");

        testCmd.literal("select", ["ts"])
            .desc("测试单选 HITL")
            .action(async (ctx: SessionContext<"command">) => this.handleTestSelect(ctx));

        testCmd.literal("confirm", ["tc"])
            .desc("测试确认 HITL")
            .action(async (ctx: SessionContext<"command">) => this.handleTestConfirm(ctx));

        testCmd.literal("text", ["tt"])
            .desc("测试文本输入 HITL")
            .action(async (ctx: SessionContext<"command">) => this.handleTestText(ctx));

        // /notify — 通知目标管理
        const notifyCmd = commandRegistry.register("notify")
            .desc("通知目标管理 — 让定时任务知道该把结果发送到哪里");

        notifyCmd.literal("create", ["add"])
            .desc("创建通知目标，直接使用当前会话（群/私聊）作为通知接收方")
            .argument(Command.argument("name").desc("给这个通知目标起个名字，如 '开发群'、'日报频道'"))
            .require("notify.create")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleNotifyCreate(ctx, args.name);
            });

        notifyCmd.literal("list", ["ls"])
            .desc("列出当前用户在当前会话中创建的所有通知目标")
            .action(async (ctx: SessionContext<"command">) => this.handleNotifyList(ctx));

        notifyCmd.literal("delete", ["rm"])
            .desc("删除指定 ID 的通知目标")
            .argument(Command.argument("id").desc("通知目标的 ID，从 /notify list 获取"))
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleNotifyDelete(ctx, args.id);
            });

        // ── Root-level aliases with specific permissions ──

        // /clear → /system thread clear
        commandRegistry.getOrCreate("clear")
            .desc("清除当前 thread 的所有对话历史")
            .require("admin.thread.clear")
            .action(async (ctx: SessionContext<"command">) => {
                return this.handleThreadClear(ctx);
            });

        // /compact → /system thread compact
        commandRegistry.getOrCreate("compact")
            .desc("压缩当前 thread 的对话上下文，保留关键信息并精简历史消息")
            .require("admin.thread.compact")
            .action(async (ctx: SessionContext<"command">) => {
                return this.handleThreadCompact(ctx);
            });

        // /new → /system session new
        commandRegistry.getOrCreate("new")
            .desc("创建新的 session")
            .argument(Command.argument("name").default(""))
            .require("admin.session.new")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleNewSession(ctx, args.name);
            });

        // /switch → /system session switch
        commandRegistry.getOrCreate("switch")
            .desc("选择一个 session，不带参数显示列表")
            .argument(Command.argument("session").default(""))
            .require("admin.session.switch")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return this.handleSelectSession(ctx, args.session);
            });
    }

    async onUnload(): Promise<void> {
        // Cleanup logic here
    }

    // ── Session Management ──

    /**
     * 创建新的 session
     */
    private async handleNewSession(ctx: SessionContext<"command">, name?: string): Promise<string> {
        const profileManager = getUserProfileManager();
        const userId = ctx.event.userId;

        // 生成 sessionId
        const sessionId = name
            ? `Session_${name}`
            : `Session_${randomUUID().substring(0, 8)}`;

        try {
            // 添加到用户的 sessions 列表
            const profile = await profileManager.addSession(userId, sessionId);

            if (!profile) {
                return "创建 session 失败，请重试";
            }

            return `已创建 session: ${sessionId}\n当前共 ${profile.sessions.length} 个 session`;
        } catch (error: any) {
            return `创建 session 失败: ${error.message}`;
        }
    }

    /**
     * 选择 session
     */
    private async handleSelectSession(ctx: SessionContext<"command">, session: string): Promise<string | void> {
        const profileManager = getUserProfileManager();
        const userId = ctx.event.userId;

        // 获取用户档案
        const profile = await profileManager.getUserProfile(userId);

        if (!profile) {
            return "未找到用户档案，请先创建 session";
        }

        if (profile.
            sessions.length === 0) {
            return "没有可用的 session，请先使用 /system session new 创建";
        }

        // 选择 none 表示使用默认
        if (session.toLowerCase() === "none") {
            await profileManager.updateProfile(userId, { selectedSession: undefined });
            return "已恢复默认 session";
        }

        // 如果没有指定 session，使用 HITL 让用户选择
        if (!session) {
            const options = profile.sessions.map(s => ({
                label: s,
                value: s,
            }));

            // 添加"使用默认"选项
            options.unshift({
                label: "使用默认",
                value: "none",
            });

            const response = await ctx.wait(createSelectRequest(
                "请选择 session",
                options,
                { timeoutMs: 30000 }
            ));

            if (response.type === "timeout") {
                return "操作超时";
            }

            if (response.type === "select" && !response.multiple && response.selected) {
                if (response.selected === "none") {
                    await profileManager.updateProfile(userId, { selectedSession: null });
                    return "已恢复默认 session";
                }
                session = response.selected;
            } else {
                return "操作已取消";
            }
        }

        // 检查 session 是否存在
        if (!profile.sessions.includes(session)) {
            return `未找到 session: ${session}`;
        }

        // 设置选中的 session
        await profileManager.updateProfile(userId, { selectedSession: session });
        return `已选中 session: ${session}`;
    }

    /**
     * 删除 session
     */
    private async handleDeleteSession(ctx: SessionContext<"command">, session: string): Promise<string | void> {
        const profileManager = getUserProfileManager();
        const userId = ctx.event.userId;

        // 获取用户档案
        const profile = await profileManager.getUserProfile(userId);

        if (!profile) {
            return "未找到用户档案";
        }

        if (profile.sessions.length === 0) {
            return "没有可删除的 session";
        }

        // 如果没有指定 session，使用 HITL 让用户选择
        if (!session) {
            const options = profile.sessions.map(s => ({
                label: s,
                value: s,
            }));

            const response = await ctx.wait(createSelectRequest(
                "请选择要删除的 session",
                options,
                { timeoutMs: 30000 }
            ));

            if (response.type === "timeout") {
                return "操作超时";
            }

            if (response.type === "select" && !response.multiple && response.selected) {
                session = response.selected;
            } else {
                return "操作已取消";
            }
        }

        // 检查 session 是否存在
        if (!profile.sessions.includes(session)) {
            return `未找到 session: ${session}`;
        }

        try {
            // 删除 session
            await profileManager.removeSession(userId, session);

            // 如果删除的是当前选中的 session，清除选中状态
            if (profile.selectedSession === session) {
                await profileManager.updateProfile(userId, { selectedSession: undefined });
            }

            return `已删除 session: ${session}`;
        } catch (error: any) {
            return `删除 session 失败: ${error.message}`;
        }
    }

    /**
     * 选择 agent
     */
    private async handleSelectAgent(ctx: SessionContext<"command">, name?: string): Promise<string | void> {
        const profileManager = getUserProfileManager();
        const userId = ctx.event.userId;

        // 如果没有指定 agent 名称，使用 HITL 让用户选择
        if (!name) {
            const agents = this.getAvailableAgents();

            if (agents.length === 0) {
                return "没有可用的 agent";
            }

            const options = agents.map(agent => ({
                label: agent.name,
                value: agent.id,
                description: agent.description,
            }));

            const response = await ctx.wait(createSelectRequest(
                "请选择 agent",
                options,
                { timeoutMs: 30000 }
            ));

            if (response.type === "timeout") {
                return "操作超时";
            }

            if (response.type === "select" && !response.multiple && response.selected) {
                name = response.selected;
            } else {
                return "操作已取消";
            }
        }

        // 检查 agent 是否存在
        if (!agentRegistry.hasAgent(name)) {
            return `未找到 agent: ${name}`;
        }

        try {
            await profileManager.setAgent(userId, name);
            return `已设置默认 agent: ${name}`;
        } catch (error: any) {
            return `设置 agent 失败: ${error.message}`;
        }
    }

    /**
     * 显示当前 session 信息
     */
    private async handleSessionInfo(ctx: SessionContext<"command">): Promise<string> {
        const profileManager = getUserProfileManager();
        const userId = ctx.event.userId;

        const profile = await profileManager.getUserProfile(userId);

        if (!profile) {
            return "未找到用户档案";
        }

        const lines = [
            "当前会话信息:",
            "",
            `Session ID: ${ctx.sessionId}`,
            `Thread ID: ${ctx.threadId}`,
            `用户 ID: ${userId}`,
            "",
            `当前选中: ${profile.selectedSession || "默认"}`,
            "",
            "Session 列表:",
        ];

        if (profile.sessions.length === 0) {
            lines.push("  (空)");
        } else {
            for (const session of profile.sessions) {
                const marker = session === profile.selectedSession ? " [当前]" : "";
                lines.push(`  - ${session}${marker}`);
            }
        }

        lines.push("");
        lines.push(`默认 Agent: ${profile.agent || "未设置"}`);

        return lines.join("\n");
    }

    /**
     * 获取所有可用的 agent
     */
    private getAvailableAgents(): Array<{ id: string; name: string; description: string }> {
        const agents: Array<{ id: string; name: string; description: string }> = [];
        const defaultId = agentRegistry.getDefaultAgentId();
        for (const [id, agent] of agentRegistry.getAll()) {
            agents.push({
                id,
                name: agent.name,
                description: agent.description + (id === defaultId ? " [默认]" : ""),
            });
        }
        return agents;
    }

    /**
     * 列出所有已注册的 agent
     */
    private handleAgentList(): string {
        const agents = this.getAvailableAgents();

        if (agents.length === 0) {
            return "没有已注册的 agent";
        }

        const lines = ["已注册的 Agent:", ""];
        const defaultId = agentRegistry.getDefaultAgentId();

        for (const a of agents) {
            const marker = a.id === defaultId ? " [默认]" : "";
            lines.push(`  ${a.id}${marker}`);
            lines.push(`    名称: ${a.name}`);
            lines.push(`    描述: ${a.description.replace(" [默认]", "")}`);
            lines.push("");
        }

        lines.push(`共 ${agents.length} 个 agent`);
        lines.push("使用 /system agent info <id> 查看详细信息");

        return lines.join("\n");
    }

    /**
     * 显示 agent 详细信息
     */
    private handleAgentInfo(name?: string): string {
        const agentId = name || agentRegistry.getDefaultAgentId();
        const agent = agentRegistry.getAgent(agentId);

        if (!agent) {
            return `未找到 agent: ${agentId}`;
        }

        const isDefault = agentId === agentRegistry.getDefaultAgentId();
        const lines = [
            `Agent 信息: ${agentId}${isDefault ? " [默认]" : ""}`,
            "",
            `名称: ${agent.name}`,
            `描述: ${agent.description}`,
            `活跃线程数: ${agent.getActiveThreadCount()}`,
            "",
        ];

        // Tool providers
        const providers = toolRegistry.getProviders();
        if (providers.length === 0) {
            lines.push("工具: (无已注册的 tool provider)");
        } else {
            const stats = toolRegistry.getStats();
            lines.push(`工具 Provider 列表 (共 ${stats.totalProviders} 个, ${stats.totalTools} 个工具):`);
            lines.push("");

            for (const [pn, count] of Object.entries(stats.toolsByProvider)) {
                const provider = providers.find(p => p.getName() === pn);
                const desc = provider ? ` — ${provider.getDescription()}` : "";
                lines.push(`  [${pn}]${desc}`);
                lines.push(`    工具数: ${count}`);

                // List individual tools
                if (provider) {
                    for (const t of provider.pullAllTools()) {
                        const briefDesc = (t.description ?? "").length > 80
                            ? (t.description ?? "").substring(0, 80) + "..."
                            : (t.description ?? "");
                        lines.push(`    - ${t.name}: ${briefDesc}`);
                    }
                }
                lines.push("");
            }
        }

        lines.push(`使用 /system agent list 查看所有 agent`);
        lines.push(`使用 /system agent <name> 切换默认 agent`);

        return lines.join("\n");
    }

    // ── Template Management ──

    private async handleTemplateList(): Promise<string> {
        const ids = await Prompts.list();

        if (ids.length === 0) {
            return "没有注册的模板（prompts 目录为空）";
        }

        let result = "可用模板列表:\n\n";
        for (const id of ids.sort()) {
            result += `  - ${id}\n`;
        }

        result += `\n共 ${ids.length} 个模板`;
        return result.trim();
    }

    private async handleTemplateDisplay(id: string): Promise<string> {
        if (!id) {
            return "请指定模板名（如: /system template display agent-system）";
        }

        const content = await Prompts.get(id);

        if (!content) {
            const ids = await Prompts.list();
            return `未找到模板: ${id}\n\n可用模板:\n${ids.join("\n")}`;
        }

        const preview = content.length > 500
            ? content.substring(0, 500) + "\n... (内容已截断)"
            : content;

        return `模板: ${id}\n${"─".repeat(30)}\n${preview}`;
    }

    private async handleTemplateSearch(keyword: string): Promise<string> {
        if (!keyword) {
            return "请输入搜索关键词";
        }

        const ids = await Prompts.list();
        const results = ids.filter(id => id.toLowerCase().includes(keyword.toLowerCase()));

        if (results.length === 0) {
            return `未找到包含 "${keyword}" 的模板`;
        }

        let result = `搜索结果 (${results.length}):\n\n`;
        for (const id of results) {
            result += `- ${id}\n`;
        }

        return result.trim();
    }

    // ── Thread Management ──

    private async handleThreadCompact(ctx: SessionContext<"command">): Promise<string> {
        // The agent's thread uses sessionId + agent name, not the command thread
        const agentThreadId = ctx.sessionId + ":default-agent";
        const agent = agentRegistry.getAgent("default-agent");

        if (!(agent instanceof DefaultAgent)) {
            return "默认 Agent 不支持 thread 操作。";
        }

        try {
            const result = await agent.compactThread(agentThreadId, 3);
            return (
                "上下文压缩完成。\n" +
                "原始消息数: " + result.originalCount + "\n" +
                "压缩后消息数: " + result.compactedCount + "\n" +
                "摘要预览: " + result.summary.substring(0, 200) + "..."
            );
        } catch (error: any) {
            return "压缩失败: " + (error.message ?? String(error));
        }
    }

    private async handleThreadClear(ctx: SessionContext<"command">): Promise<string> {
        const agentThreadId = ctx.sessionId + ":default-agent";
        const agent = agentRegistry.getAgent("default-agent");

        if (!(agent instanceof DefaultAgent)) {
            return "默认 Agent 不支持 thread 操作。";
        }

        try {
            await agent.clearThread(agentThreadId);
            return "已清除 thread 上下文。下次对话将从零开始。";
        } catch (error: any) {
            return "清除失败: " + (error.message ?? String(error));
        }
    }

    // ── System Info ──

    private async handleSystemInfo(): Promise<string> {
        const stats = await TokenStore.getInstance().getStats();

        const lines = [
            "token usage stats",
            "",
            "overall:",
            "  calls: " + stats.total_calls,
            "  input:  " + stats.total_input.toLocaleString(),
            "  output: " + stats.total_output.toLocaleString(),
        ];

        if (stats.byModel.length > 0) {
            lines.push("");
            lines.push("per model:");
            for (const m of stats.byModel) {
                const name = m.model_name ? m.model + " (" + m.model_name + ")" : m.model;
                lines.push("  [" + name + "]");
                lines.push("    calls: " + m.total_calls);
                lines.push("    input:  " + m.total_input.toLocaleString());
                lines.push("    output: " + m.total_output.toLocaleString());
            }
        }

        return lines.join("\n");
    }

    // ── HITL Test ──

    private async handleTestSelect(ctx: SessionContext<"command">): Promise<string | void> {
        const response = await ctx.wait(createSelectRequest("请选择操作", [
            { label: "查看详情", value: "detail" },
            { label: "编辑", value: "edit" },
            { label: "删除", value: "delete" },
        ], { timeoutMs: 30000 }));
        if (response.type === "timeout") return "操作超时";
        if (response.type === "select" && !response.multiple && response.selected)
            return "你选择了: " + response.selected;
        return "无效的响应";
    }

    private async handleTestConfirm(ctx: SessionContext<"command">): Promise<string | void> {
        const { createConfirmRequest, isConfirmResponse } = await import("@meowbot/gateway/hitl.js");
        const response = await ctx.wait(createConfirmRequest("确定要执行此操作吗？", { timeoutMs: 30000 }));
        if (response.type === "timeout") return "操作超时";
        if (response.type === "confirm") return response.confirmed ? "你确认了操作" : "你取消了操作";
        return "无效的响应";
    }

    private async handleTestText(ctx: SessionContext<"command">): Promise<string | void> {
        const { createTextRequest } = await import("@meowbot/gateway/hitl.js");
        const response = await ctx.wait(createTextRequest("请输入一些内容：", { placeholder: "在这里输入...", maxLength: 100, timeoutMs: 30000 }));
        if (response.type === "timeout") return "操作超时";
        if (response.type === "text") return "你输入了: " + response.text;
        return "无效的响应";
    }

    // ── Notify ──

    private async handleNotifyCreate(ctx: SessionContext<"command">, name: string): Promise<string> {
        const { getPermissionService } = await import("@meowbot/permission/index.js");
        if (!await getPermissionService().requireAllowed(ctx.event.userId, "notify.create.public"))
            return "你不能创建这样的通知目标。";
        const event = ctx.event as any;
        const publicId = event.extra?.groupId ?? event.groupId ?? event.userId;
        const target = await NotificationTargetModel.create({
            publicId, userId: event.userId, name,
            adapterName: event.adapter ?? "unknown", createdAt: new Date(),
        });
        return "通知目标已创建。\nID: " + target._id + "\n名称: " + target.name;
    }

    private async handleNotifyList(ctx: SessionContext<"command">): Promise<string> {
        const event = ctx.event as any;
        const publicId = event.extra?.groupId ?? event.groupId ?? event.userId;
        const targets = await NotificationTargetModel.find({ publicId }).lean();
        if (targets.length === 0) return "你还没有通知目标。使用 /notify create <名称> 创建一个。";
        return targets.map(t => t._id + " | " + t.name + " | " + t.adapterName).join("\n");
    }

    private async handleNotifyDelete(ctx: SessionContext<"command">, id: string): Promise<string> {
        const result = await NotificationTargetModel.deleteOne({ _id: id });
        if (result.deletedCount === 0) return "未找到该通知目标。";
        return "已删除通知目标: " + id;
    }
}
