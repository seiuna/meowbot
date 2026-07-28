/**
 * Prompt context — gathers global, config, and session-specific template variables
 * for rendering system prompts with ${placeholders}.
 *
 * Global variables:
 *   ${systime}, ${timezone}, ${os}, ${hostname}, ${pid}
 *
 * Config variables (from config/placeholder.json):
 *   ${bot_name}, ${bot_version}
 *   ${qq_master_id}, ${qq_master_name}
      ${qq_master_id}, ${qq_master_name}
 *
 * Per-platform master (resolved dynamically by adapter):
 *   ${masterId}, ${masterName}
 *
 * Session variables:
 *   ${message}, ${userId}, ${publicId}, ${username}
 */

import { hostname, platform } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const OS_MAP: Record<string, string> = {
    win32: "Windows", linux: "Linux", darwin: "macOS", freebsd: "FreeBSD",
};

// ── Config placeholders ──

interface MasterEntry { userId: string; name: string; }
interface PlaceholderConfig {
    masters: Record<string, MasterEntry>;
    bot: { name: string; version: string };
}

function loadPlaceholders(): PlaceholderConfig {
    const path = resolve(import.meta.dirname, "..", "..", "config", "placeholder.json");
    try {
        if (existsSync(path)) {
            return JSON.parse(readFileSync(path, "utf-8"));
        }
    } catch (err) {
        console.warn("Failed to load config/placeholder.json:", err);
    }
    return { masters: {}, bot: { name: "MeowBot", version: "1.0.0" } };
}

const placeholders = loadPlaceholders();

// ── Global static context ──

const globalContext: Record<string, string> = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    os: OS_MAP[platform()] ?? platform(),
    hostname: hostname(),
    pid: String(process.pid),
    bot_name: placeholders.bot.name,
    bot_version: placeholders.bot.version,
    // Per-platform masters as flat keys
    ...Object.fromEntries(
        Object.entries(placeholders.masters).flatMap(([adapter, m]) => [
            [`${adapter}_master_id`, m.userId],
            [`${adapter}_master_name`, m.name],
        ])
    ),
};

/** Get global + time-based context. */
export function getGlobalContext(): Record<string, string> {
    return {
        ...globalContext,
        systime: new Date().toLocaleString("zh-CN", {
            timeZone: globalContext.timezone,
            dateStyle: "full",
            timeStyle: "medium",
        }),
    };
}

/** Get full context with session data and per-platform master resolved. */
export function getPromptContext(session?: {
    userId?: string; publicId?: string; username?: string; message?: string; adapter?: string;
}): Record<string, string> {
    // Resolve per-platform master
    const adapter = session?.adapter ?? "";
    const master = placeholders.masters[adapter];
    return {
        ...getGlobalContext(),
        masterId: master?.userId ?? "",
        masterName: master?.name ?? "",
        userId: session?.userId ?? "",
        publicId: session?.publicId ?? "",
        username: session?.username ?? "",
        message: session?.message ?? "",
    };
}
