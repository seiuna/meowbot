import log4js from "log4js";

// ── Custom level colors ──
const LEVEL_COLORS: Record<string, string> = {
    TRACE: "\x1b[90m",   // gray
    DEBUG: "\x1b[35m",   // purple
    INFO:  "\x1b[34m",   // blue
    WARN:  "\x1b[33m",   // yellow
    ERROR: "\x1b[31m",   // red
    FATAL: "\x1b[31m",   // red
};
const RESET = "\x1b[0m";

log4js.addLayout("meowbot-colors", () => (logEvent: any) => {
    const color = LEVEL_COLORS[logEvent.level.levelStr] || RESET;
    const ts = logEvent.startTime.toLocaleString("zh-CN", { hour12: false });
    return `${RESET}${color}[${ts}] [${logEvent.level.levelStr}] [${logEvent.categoryName}]${RESET} ${logEvent.data.join(" ")}`;
});

log4js.configure({
    appenders: {
        console: {
            type: "console",
            layout: { type: "meowbot-colors" },
        },
    },
    categories: {
        default: {
            appenders: ["console"],
            level: process.env.LOG_LEVEL || "trace",
            enableCallStack: true,
        },
    },
});

export function getLogger(name: string): log4js.Logger {
    return log4js.getLogger(name);
}

export type Logger = log4js.Logger;

export { log4js };