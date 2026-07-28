import { Middleware, SessionContext, SessionType } from "@meowbot/gateway";
import { commandRegistry } from "./dispatcher.js";
import { CommandEvent } from "@meowbot/gateway/adapters/types";
import type { CmdResult } from "./command.js";
import { getLogger } from "@meowbot/utils/logs";

const logger = getLogger("CommandDispatcherMiddleware");

function isCmdResult(v: unknown): v is CmdResult {
    return typeof v === "object" && v !== null && "ok" in v && "message" in v;
}

/**
 * Command Dispatcher Middleware
 * Handles command messages before they reach the Agent dispatcher.
 * If the session type is "command", it processes the command and stops the pipeline.
 * Otherwise, it passes control to the next middleware.
 */
export const CommandDispatcherMiddleware: Middleware<SessionContext<SessionType>> = async (ctx, next) => {
    if (ctx.sessionType !== "command") {
        await next();
        return;
    }

    try {
        const event = ctx.event as CommandEvent;
        const cmdName = event.command;
        const rawArgs = event.args;

        if (!cmdName) {
            ctx.message("请输入有效命令。输入 /help 查看可用命令。");
            return;
        }

        if (cmdName.toLowerCase() === "help") {
            const userId = ctx.event.userId;
            ctx.message(await commandRegistry.generateHelpMenu(userId));
            return;
        }

        const inputString = [cmdName, ...rawArgs].join(" ");
        const result = await commandRegistry.execute(inputString, ctx as SessionContext<"command">);
        if (typeof result === "string") {
            ctx.message(result);
        } else if (isCmdResult(result)) {
            ctx.message(result.message);
        }
    } catch (error) {
        logger.error(`Command dispatcher error: ${error}`);
        ctx.message("系统执行命令时遇到错误，请稍后再试。");
    }
};
