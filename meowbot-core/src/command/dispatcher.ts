import { Command, ArgsType, checkScope, type CmdResult } from "./command.js";
import { getLogger } from "../utils/logs.js";
import { SessionContext } from "@meowbot/gateway";
import { CommandEvent } from "@meowbot/gateway/adapters/types";
import { getPermissionService } from "../permission/service.js";
import { registerPermissionCommands } from "./permission_commands.js";

const logger = getLogger("CommandDispatcher");

// ── Command Context ──

export class CommandContext {
    constructor(private args: ArgsType) {}

    get<K extends keyof ArgsType>(key: K): ArgsType[K] {
        return this.args[key];
    }

    getAll(): ArgsType {
        return { ...this.args };
    }
}

// ── Command Registry ──

export class CommandRegistry {
    /** Root command routing table (name -> command node) */
    private roots: Map<string, Command> = new Map();
    /** All root commands for help generation */
    private rootCommands: Map<string, Command> = new Map();

    /**
     * Register a root command with optional aliases
     * @param rootName - Primary command name
     * @param aliases - Alternative names for the same command
     * @returns The root Command node
     */
    register(rootName: string, aliases: string[] = []): Command {
        const rootNode = new Command(rootName);
        this.roots.set(rootName.toLowerCase(), rootNode);
        this.rootCommands.set(rootName, rootNode);

        for (const alias of aliases) {
            this.roots.set(alias.toLowerCase(), rootNode);
        }

        logger.info(`Registered /${rootName} command${aliases.length > 0 ? ` (aliases: ${aliases.join(", ")})` : ""}`);
        return rootNode;
    }

    /**
     * Get an existing root command or create a new one.
     * Useful when multiple plugins need to add children to the same root
     * regardless of load order.
     */
    getOrCreate(rootName: string, aliases: string[] = []): Command {
        const existing = this.roots.get(rootName.toLowerCase());
        if (existing) {
            // Add any new aliases that weren't registered yet
            for (const alias of aliases) {
                if (!this.roots.has(alias.toLowerCase())) {
                    this.roots.set(alias.toLowerCase(), existing);
                }
            }
            return existing;
        }
        return this.register(rootName, aliases);
    }

    /**
     * Get a root command by name (supports aliases)
     */
    get(name: string): Command | undefined {
        return this.roots.get(name.toLowerCase());
    }

    /**
     * Get all registered root commands (primary names only, no aliases).
     */
    getRootCommands(): Map<string, Command> {
        return new Map(this.rootCommands);
    }

    /**
     * Execute a command string
     * @param inputString - The full command string (without leading /)
     * @param context - The session context for execution
     */
    async execute(inputString: string, context: SessionContext<"command">): Promise<CmdResult | string | void> {
        const parts = inputString.trim().split(/\s+/);
        if (parts.length === 0 || parts[0] === "") {
            return Command.fail("invalid_args", "请输入有效命令。输入 /help 查看可用命令。");
        }

        const rootName = parts[0].toLowerCase();
        let currentNode = this.roots.get(rootName);

        if (!currentNode) {
            return Command.fail("not_found", `未知命令: /${parts[0]}\n输入 /help 查看帮助。`);
        }

        const argsDict: ArgsType = {};
        const path: string[] = [currentNode.name];
        let idx = 1;

        while (idx < parts.length) {
            // Check for redirect at start of iteration
            if (currentNode.redirectTarget) {
                currentNode = currentNode.redirectTarget;
                path.push(currentNode.name);
            }

            const part = parts[idx].toLowerCase();

            // 1. Match literal child (or alias)
            if (currentNode.children.has(part)) {
                currentNode = currentNode.children.get(part)!;
                path.push(currentNode.name);
                idx++;
            }
            // 2. Match dynamic argument
            else if (currentNode.argChild) {
                currentNode = currentNode.argChild;
                argsDict[currentNode.name] = parts[idx]; // 保留原始大小写
                path.push(currentNode.name);
                idx++;
            }
            // 3. No match - show usage hint
            else {
                return this.generateUsageHint(currentNode, parts.slice(0, idx).join(" "));
            }
        }

        // Tail redirect check
        if (currentNode.redirectTarget) {
            currentNode = currentNode.redirectTarget;
            path.push(currentNode.name);
        }

        // Default value fallback for arguments
        if (currentNode.argChild && idx >= parts.length) {
            const nextNode = currentNode.argChild;
            if (nextNode.defaultValue !== undefined) {
                argsDict[nextNode.name] = nextNode.defaultValue;
                currentNode = nextNode;
                path.push(currentNode.name);
            }
        }

        // Permission check on the resolved canonical command path.
        // Skip for bootstrap commands like /perm register <key>.
        const userId = context.event.userId;
        const resource = "command." + path.join(".");
        if (resource !== "command.perm.register.key") {
            const permissionResult = await getPermissionService().check(userId, resource);
            if (!permissionResult.allowed) {
                logger.warn("Permission denied for " + userId + " on " + resource);
                return Command.fail("permission_denied", "你没有权限执行此命令。");
            }
        }

        // Check declared required permissions (e.g. .require("admin.permission")).
        // Uses isAllowed (default-allow) — when no rules match, defaults to true.
        if (currentNode.requiredPermissions.length > 0) {
            for (const required of currentNode.requiredPermissions) {
                const allowed = await getPermissionService().isAllowed(userId, required);
                if (!allowed) {
                    logger.warn(`Permission denied for ${userId}: missing ${required}`);
                    return Command.fail("permission_denied", "你没有权限执行此命令。");
                }
            }
        }

        // Check adapter scope restriction (e.g. .scope("qq") or .scope("all", "!qq")).
        if (currentNode.scopeRules.length > 0 && !checkScope(currentNode.scopeRules, context.event.adapter)) {
            logger.warn(`Scope denied for ${userId}: command not available on adapter ${context.event.adapter}`);
            return Command.fail("scope_denied", "此命令不可在当前平台使用。");
        }

        // Execute action
        if (currentNode.actionCallback) {
            try {
                return await currentNode.actionCallback(context, argsDict);
            } catch (error: any) {
                logger.error(`Command execution error: ${error.message}`);
                return Command.fail("execution_error", `命令执行错误: ${error.message}`);
            }
        }

        // No action defined - show usage hint
        return Command.fail("no_action", this.generateUsageHint(currentNode, parts.join(" ")));
    }

    /**
     * Generate usage hint for a command node
     */
    private generateUsageHint(node: Command, currentPath: string): string {
        const hints: string[] = [`命令不完整。用法:`];

        // If node has children, show available subcommands
        if (node.children.size > 0) {
            const subcmds: string[] = [];
            const seen = new Set<string>();

            for (const [name, child] of node.children) {
                // Only show primary names (not aliases)
                if (!seen.has(child.name)) {
                    seen.add(child.name);
                    const desc = child.description ? ` - ${child.description}` : "";
                    subcmds.push(`  /${currentPath} ${child.name}${desc}`);
                }
            }

            if (subcmds.length > 0) {
                hints.push("\n可用子命令:");
                hints.push(...subcmds);
            }
        }

        // If node has arg child, show argument info
        if (node.argChild) {
            const argName = node.argChild.name;
            const desc = node.argChild.description ? ` (${node.argChild.description})` : "";
            hints.push(`\n参数: <${argName}>${desc}`);

            if (node.argChild.defaultValue !== undefined) {
                hints.push(`默认值: ${node.argChild.defaultValue}`);
            }
        }

        // If node has action but no children/args, it should have executed
        // Show description if available
        if (node.description && node.children.size === 0 && !node.argChild) {
            hints.push(`\n${node.description}`);
        }

        return hints.join("\n");
    }

    /**
     * Generate help menu for all registered commands.
     * When userId is provided, filters out commands the user doesn't have permission to access.
     */
    async generateHelpMenu(userId?: string): Promise<string> {
        const lines: string[] = ["可用命令列表:"];

        const canAccess = async (path: string, node: Command): Promise<boolean> => {
            if (!userId) return true;

            // 1. Resource-based check (command.a.b.c)
            const resource = `command.${path.replace(/\//g, "").replace(/\s+/g, ".")}`;
            const resourceResult = await getPermissionService().check(userId, resource);
            if (!resourceResult.allowed) return false;

            // 2. Explicit .require() check — must have positive allow rule
            for (const required of node.requiredPermissions) {
                if (!(await getPermissionService().requireAllowed(userId, required))) {
                    return false;
                }
            }

            return true;
        };

        for (const [name, cmd] of this.rootCommands) {
            const help = userId
                ? await cmd.getHelpFiltered("", canAccess)
                : cmd.getHelp();
            if (help) {
                lines.push(help);
            }
        }

        return lines.join("\n");
    }
}

// ── Singleton Instance ──

export const commandRegistry = new CommandRegistry();

// ── Legacy Support ──

/**
 * Legacy command dispatcher - kept for backward compatibility
 * @deprecated Use CommandRegistry.execute() instead
 */
export async function CMDdispatcher(context: SessionContext<"command">): Promise<void> {
    try {
        const event = context.event as CommandEvent;
        const cmdName = event.command;
        const rawArgs = event.args;

        if (!cmdName) {
            context.message("请输入有效命令。输入 /help 查看可用命令。");
            return;
        }

        if (cmdName.toLowerCase() === "help") {
            const userId = context.event.userId;
            context.message(await commandRegistry.generateHelpMenu(userId));
            return;
        }

        const inputString = [cmdName, ...rawArgs].join(" ");
        const result = await commandRegistry.execute(inputString, context);
        if (typeof result === "string") {
            context.message(result);
        }
    } catch (error) {
        logger.error(`[Dispatcher Error]: ${error}`);
        context.message("系统执行命令时遇到错误，请稍后再试。");
    }
}

export async function bootstrapCommandRegistry() {
    // Core permission management commands
    registerPermissionCommands(commandRegistry);
}
