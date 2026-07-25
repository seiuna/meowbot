/**
 * Permission administration commands
 *
 * Provides chat commands for managing user permissions and groups.
 *
 * Bootstrap safety:
 *   - If no permission groups exist in the database, anyone can use /perm.
 *   - Once the first group is created, the caller must have `admin.permission`
 *     (or the caller must belong to the "admin" group) to use /perm.
 */

import { CommandRegistry } from "./dispatcher.js";
import { Command } from "./command.js";
import { getPermissionManager } from "../permission/manager.js";
import { getPermissionService } from "../permission/service.js";
import { BootstrapKeyManager } from "../permission/bootstrap_key.js";
import { SessionContext } from "@meowbot/gateway/index.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("PermissionCommands");

const ADMIN_PERMISSION = "admin.permission";

/**
 * Check if the caller is allowed to administrate permissions.
 * During bootstrap (no groups exist), only /perm register is allowed.
 * @param allowBootstrap - If true, allows the action during bootstrap mode (for /perm register)
 */
async function assertAdmin(
    ctx: SessionContext<"command">,
    allowBootstrap = false
): Promise<string | null> {
    const manager = getPermissionManager();
    const groups = await manager.listGroups();

    if (groups.length === 0) {
        if (allowBootstrap) {
            return null; // bootstrap mode: only /perm register is allowed
        }
        return "权限系统尚未初始化。请先使用 /perm register <密钥> 注册管理员。";
    }

    const userId = ctx.event.userId;
    const allowed = await getPermissionService().isAllowed(userId, ADMIN_PERMISSION);
    if (!allowed) {
        return "你没有权限管理权限系统。";
    }
    return null;
}

function parseQuotedArgs(args: string[]): string[] {
    const result: string[] = [];
    let current = "";
    let inQuote = false;
    for (const arg of args) {
        if (arg.startsWith('"') && arg.endsWith('"') && arg.length > 1) {
            result.push(arg.slice(1, -1));
            continue;
        }
        if (arg.startsWith('"')) {
            inQuote = true;
            current = arg.slice(1);
            continue;
        }
        if (arg.endsWith('"')) {
            current += " " + arg.slice(0, -1);
            result.push(current);
            current = "";
            inQuote = false;
            continue;
        }
        if (inQuote) {
            current += " " + arg;
        } else if (arg.length > 0) {
            result.push(arg);
        }
    }
    if (inQuote && current.length > 0) {
        result.push(current);
    }
    return result.filter((s) => s.length > 0);
}

export function registerPermissionCommands(registry: CommandRegistry): void {
    const perm = registry.register("perm", ["permission"])
        .desc("权限系统管理 — 管理用户权限、权限组和注册");

    // /perm register <key> — 使用启动密钥注册为管理员，获得 * 全部权限
    perm.literal("register", ["reg"])
        .desc("使用启动时打印的注册密钥获得管理员权限。密钥为一次性使用。")
        .argument(Command.argument("key").desc("8 位启动注册密钥，启动时在控制台打印"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx, true);
            if (denied) return denied;

            const keyManager = BootstrapKeyManager.getInstance();

            if (keyManager.isConsumed()) {
                return "注册密钥已被使用。如需新密钥，请重启服务。";
            }

            if (!keyManager.validate(args.key)) {
                return "注册密钥无效。";
            }

            // Grant * (all permissions) to the calling user
            const userId = ctx.event.userId;
            const ok = await getPermissionManager().setUserPermissions(userId, ["*"]);
            if (!ok) {
                return "权限授予失败，请重试。";
            }

            logger.info("User " + userId + " registered with bootstrap key, granted *");
            return "注册成功！你已获得 * (全部) 权限。";
        });

    // /perm user <userId> — 用户权限管理
    const user = perm.literal("user", ["u"])
        .desc("管理用户权限 — 设置权限规则、分配权限组、检查权限");

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID（QQ号等）"))
        .literal("addperm", ["ap"])
        .desc("给用户追加一条权限规则（纯权限，不会匹配权限组）")
        .argument(Command.argument("perm").desc("权限规则，如 'command.system'、'admin.file'"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const profile = await getPermissionManager().getUserPermissionProfile(args.userId);
            const newPerms = [...profile.permissions, args.perm];
            const ok = await getPermissionManager().setUserPermissions(args.userId, newPerms);
            return ok
                ? "已为用户 " + args.userId + " 追加权限: " + args.perm + "\n当前权限: " + (newPerms.join(" ") || "(无)")
                : "更新失败。";
        });

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID（QQ号等）"))
        .literal("add", ["a"])
        .desc("给用户追加一条权限规则或加入一个权限组。自动判断：如果参数是已存在的权限组名则加入该组，否则作为权限规则追加")
        .argument(Command.argument("perm").desc("权限规则或权限组名称。如 'command.system' 或 'admin'"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            // Check if it's a group name
            const group = await getPermissionManager().getGroup(args.perm);
            if (group) {
                const ok = await getPermissionManager().addUserToGroup(args.userId, args.perm);
                return ok
                    ? `已将用户 ${args.userId} 加入权限组 ${args.perm}`
                    : "操作失败。";
            }

            // Treat as a direct permission rule — append
            const profile = await getPermissionManager().getUserPermissionProfile(args.userId);
            const newPerms = [...profile.permissions, args.perm];
            const ok = await getPermissionManager().setUserPermissions(args.userId, newPerms);
            return ok
                ? `已为用户 ${args.userId} 追加权限: ${args.perm}\n当前权限: ${newPerms.join(" ") || "(无)"}`
                : "更新失败。";
        });

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID（QQ号等）"))
        .literal("set", ["s"])
        .desc("设置用户的直接权限规则，覆盖原有规则")
        .argument(Command.argument("rules").desc("权限规则，空格分隔，支持 * 通配符、! 否定。如 'command.* !command.admin'"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const rules = parseQuotedArgs(args.rules.split(/\s+/));
            const ok = await getPermissionManager().setUserPermissions(args.userId, rules);
            return ok
                ? `已更新用户 ${args.userId} 的权限: ${rules.join(" ") || "(无)"}`
                : "更新失败。";
        });

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID"))
        .literal("groups", ["g"])
        .desc("设置用户所属的权限组列表，覆盖原有组")
        .argument(Command.argument("groupNames").desc("权限组名称，空格分隔"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const groups = args.groupNames ? parseQuotedArgs(args.groupNames.split(/\s+/)) : [];
            const ok = await getPermissionManager().setUserGroups(args.userId, groups);
            return ok
                ? `已更新用户 ${args.userId} 的权限组: ${groups.join(", ") || "(无)"}`
                : "更新失败。";
        });

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID"))
        .literal("addgroup", ["ag"])
        .desc("将用户添加到指定权限组（保留原有组）")
        .argument(Command.argument("groupName").desc("权限组名称"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const ok = await getPermissionManager().addUserToGroup(args.userId, args.groupName);
            return ok
                ? `已将用户 ${args.userId} 加入组 ${args.groupName}`
                : "操作失败。";
        });

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID"))
        .literal("removegroup", ["rg"])
        .desc("将用户从指定权限组移除")
        .argument(Command.argument("groupName").desc("权限组名称"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const ok = await getPermissionManager().removeUserFromGroup(args.userId, args.groupName);
            return ok
                ? `已将用户 ${args.userId} 从组 ${args.groupName} 移除`
                : "操作失败。";
        });

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID"))
        .literal("check", ["c"])
        .desc("检查用户是否有某个资源的访问权限")
        .argument(Command.argument("resource").desc("资源路径，如 'command.system.info'、'admin.template'"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const result = await getPermissionService().check(args.userId, args.resource);
            return result.allowed
                ? `允许: ${args.userId} -> ${args.resource}` +
                  (result.decidedBy ? ` (${result.decidedBy})` : "")
                : `拒绝: ${args.userId} -> ${args.resource}` +
                  (result.decidedBy ? ` (${result.decidedBy})` : "");
        });

    user.argument(Command.argument("userId").desc("目标用户的唯一 ID"))
        .literal("info", ["i"])
        .desc("查看用户的完整权限配置（直接权限规则 + 所属权限组）")
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const profile = await getPermissionManager().getUserPermissionProfile(args.userId);
            const lines = [
                `用户: ${args.userId}`,
                `直接权限: ${profile.permissions.join(" ") || "(无)"}`,
                `所属组: ${profile.groups.join(", ") || "(无)"}`,
            ];
            return lines.join("\n");
        });

    // /perm group — 权限组管理
    const group = perm.literal("group", ["g"])
        .desc("管理权限组 — 创建、删除、查看权限组");

    group.argument(Command.argument("name").desc("权限组名称"))
        .literal("create", ["c", "set"])
        .desc("创建新权限组或覆盖更新已有权限组")
        .argument(Command.argument("rules").desc("权限规则，空格分隔。如 'command.* admin.template'"))
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const rules = parseQuotedArgs(args.rules.split(/\s+/));
            const created = await getPermissionManager().upsertGroup(args.name, rules);
            return `已更新权限组 ${created.name}: ${created.permissions.join(" ") || "(无)"}`;
        });

    group.argument(Command.argument("name").desc("权限组名称"))
        .literal("delete", ["d", "del"])
        .desc("删除指定权限组，同时从所有用户身上移除此组")
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const ok = await getPermissionManager().deleteGroup(args.name);
            return ok ? `已删除权限组 ${args.name}` : "权限组不存在。";
        });

    group.argument(Command.argument("name").desc("权限组名称"))
        .literal("info", ["i"])
        .desc("查看权限组的详细信息（描述、优先级、包含的权限规则）")
        .action(async (ctx, args) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const g = await getPermissionManager().getGroup(args.name);
            if (!g) return `权限组 ${args.name} 不存在。`;
            const lines = [
                `组名: ${g.name}`,
                `描述: ${g.description || "(无)"}`,
                `优先级: ${g.priority ?? 0}`,
                `权限: ${g.permissions.join(" ") || "(无)"}`,
            ];
            return lines.join("\n");
        });

    group.literal("list", ["ls"])
        .desc("列出系统中所有已创建的权限组")
        .action(async (ctx) => {
            const denied = await assertAdmin(ctx);
            if (denied) return denied;

            const groups = await getPermissionManager().listGroups();
            if (groups.length === 0) return "当前没有权限组。";
            return groups.map((g) => `- ${g.name}: ${g.permissions.join(" ") || "(无)"}`).join("\n");
        });

    logger.info("Registered permission admin commands");
}
