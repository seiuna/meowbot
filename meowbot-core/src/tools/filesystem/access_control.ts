/**
 * Filesystem access control for the FileSystem tools.
 *
 * Two-layer path policy, independent from the tool-level permission system
 * (`fs.read` / `fs.write` permission paths):
 *
 * 1. Blacklist (deny patterns) — always evaluated first and always wins.
 *    Merged with {@link DEFAULT_BLACKLIST} which protects the most sensitive
 *    locations even when the user config is empty.
 * 2. Whitelist (allow patterns) — when non-empty, becomes default-deny:
 *    only paths matching the whitelist are allowed.
 *
 * Patterns are matched against normalized absolute paths (forward slashes,
 * collapsed `..`, lowercase drive letters on Windows, trailing slash stripped).
 * Symlinks/junctions are handled by re-checking the real path of the deepest
 * existing ancestor, so a whitelisted link pointing outside the allowlist is
 * still denied.
 */

import path from "node:path";
import { realpath } from "node:fs/promises";
import { createReactiveConfig } from "@meowbot/config";
import { FsConfigSchema, type FsConfig } from "@meowbot/shared";
import { globToRegex } from "../../utils/glob.js";
import { getLogger } from "../../utils/logs.js";

const logger = getLogger("FsAccessControl");

/**
 * Built-in default blacklist. Always merged with the user blacklist so that the
 * most sensitive locations are protected even with an empty config.
 */
export const DEFAULT_BLACKLIST: string[] = [
    "**/.git",
    "**/.git/**",
    "**/node_modules",
    "**/node_modules/**",
    "**/.ssh",
    "**/.ssh/**",
    "**/.aws",
    "**/.aws/**",
    "**/meowbot-core/config",
    "**/meowbot-core/config/**",
    "C:/Windows",
    "C:/Windows/**",
    "/etc",
    "/etc/**",
    "/proc",
    "/proc/**",
    "/sys",
    "/sys/**",
    "/dev",
    "/dev/**",
];

interface PathRule {
    pattern: string;
    regex: RegExp;
}

export interface FsAccessDecision {
    allowed: boolean;
    /** Blacklist pattern that denied the path. */
    matchedPattern?: string;
    /** True when the whitelist is non-empty and the path did not match it. */
    defaultDenied?: boolean;
}

export type FsAccessResult =
    | { ok: true; path: string }
    | { ok: false; error: string };

/**
 * Normalize a real path for matching.
 *
 * Windows-style absolute paths (`C:/...`, `C:\...`, `\\?\C:\...`) are
 * normalized independently of the host platform — a drive-letter path is a
 * Windows path no matter where the process runs, so matching stays consistent
 * (case-insensitive, `..` collapsed, forward slashes).
 *
 * Host-native absolute paths are resolved with `path.resolve()` and normalized
 * the same way.
 */
export function normalizeFsPath(raw: string): string {
    let p = raw.trim();
    // Strip the \\?\ long-path / device prefix on Windows.
    p = p.replace(/^\\\\\?\\/, "");

    if (/^[A-Za-z]:[\\/]/.test(p)) {
        // Windows-style absolute path (e.g. C:/foo, C:\foo, E:/a/../b).
        const parts = p.replace(/\\/g, "/").toLowerCase().split("/");
        const drive = parts[0];
        const rest: string[] = [];
        for (const seg of parts.slice(1)) {
            if (seg === "" || seg === ".") continue;
            if (seg === "..") {
                rest.pop();
            } else {
                rest.push(seg);
            }
        }
        return rest.length === 0 ? drive + "/" : drive + "/" + rest.join("/");
    }

    p = path.resolve(p);
    p = p.replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(p)) {
        // Windows paths are case-insensitive — normalize fully for matching.
        p = p.toLowerCase();
    }
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p;
}

/** Normalize a glob pattern for matching (no resolve — it is not a real path). */
function normalizePattern(raw: string): string {
    let p = raw.trim();
    p = p.replace(/\\/g, "/");
    if (process.platform === "win32" || /^[A-Za-z]:/.test(p)) {
        p = p.toLowerCase();
    }
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p;
}

function compileRules(patterns: string[]): PathRule[] {
    const caseInsensitive = process.platform === "win32";
    return patterns.map(pattern => ({
        pattern,
        regex: globToRegex(normalizePattern(pattern), caseInsensitive),
    }));
}

/**
 * Resolve the real path of the deepest existing ancestor of `rawPath`
 * (resolves symlinks/junctions), then append the missing tail.
 */
export async function resolveExistingAncestor(rawPath: string): Promise<string> {
    const abs = path.resolve(rawPath);
    let probe = abs;
    const tail: string[] = [];
    for (;;) {
        try {
            const real = await realpath(probe);
            const combined = path.join(real, ...tail);
            return normalizeFsPath(combined);
        } catch {
            const parent = path.dirname(probe);
            if (parent === probe) {
                // Nothing exists at all (e.g. invalid drive) — fall back to literal.
                return normalizeFsPath(abs);
            }
            tail.unshift(path.basename(probe));
            probe = parent;
        }
    }
}

export class FsAccessControl {
    private whitelist: PathRule[] = [];
    private blacklist: PathRule[] = [];
    private config: FsConfig;

    constructor(config: FsConfig) {
        this.config = config;
        this.recompile();
    }

    private recompile(): void {
        this.whitelist = compileRules(this.config.whitelist ?? []);
        this.blacklist = compileRules([
            ...DEFAULT_BLACKLIST,
            ...(this.config.blacklist ?? []),
        ]);
        logger.debug(
            `Access control rules loaded: ${this.whitelist.length} whitelist, ${this.blacklist.length} blacklist patterns`,
        );
    }

    /** Replace the config and recompile rules (called on reactive config change). */
    public update(config: FsConfig): void {
        this.config = config;
        this.recompile();
    }

    public getConfig(): FsConfig {
        return {
            whitelist: [...(this.config.whitelist ?? [])],
            blacklist: [...(this.config.blacklist ?? [])],
        };
    }

    /** Synchronous check of the literal (normalized) path only. */
    public check(rawPath: string): FsAccessDecision {
        const normalized = normalizeFsPath(rawPath);
        for (const rule of this.blacklist) {
            if (rule.regex.test(normalized)) {
                return { allowed: false, matchedPattern: rule.pattern };
            }
        }
        if (this.whitelist.length > 0) {
            for (const rule of this.whitelist) {
                if (rule.regex.test(normalized)) return { allowed: true };
            }
            return { allowed: false, defaultDenied: true };
        }
        return { allowed: true };
    }

    public isAllowed(rawPath: string): boolean {
        return this.check(rawPath).allowed;
    }

    /**
     * Full check: literal path AND the real path of its deepest existing
     * ancestor. Returns the resolved path to operate on when allowed.
     */
    public async verify(rawPath: string): Promise<FsAccessResult> {
        const literal = this.check(rawPath);
        if (!literal.allowed) return { ok: false, error: describeDecision(literal) };
        const resolved = await resolveExistingAncestor(rawPath);
        const real = this.check(resolved);
        if (!real.allowed) return { ok: false, error: describeDecision(real) };
        return { ok: true, path: resolved };
    }

    /** Keep only entries whose paths pass the policy (used when listing directories). */
    public filterEntries<T extends { path: string }>(entries: T[]): T[] {
        return entries.filter(entry => this.check(entry.path).allowed);
    }
}

function describeDecision(decision: FsAccessDecision): string {
    if (decision.matchedPattern) {
        return `Path denied by access control (blacklist rule: ${decision.matchedPattern})`;
    }
    if (decision.defaultDenied) {
        return "Path denied by access control (not in whitelist)";
    }
    return "Path denied by access control";
}

// ── Singleton ──

let instance: FsAccessControl | null = null;
/** Test override hook — lets tests install an isolated instance. */
let testInstance: FsAccessControl | null = null;

export function getFsAccessControl(): FsAccessControl {
    if (testInstance) return testInstance;
    if (!instance) {
        const config = createReactiveConfig<FsConfig>(
            "fs:access",
            { whitelist: [], blacklist: [] },
            FsConfigSchema,
            (value) => { instance?.update(value); },
        );
        instance = new FsAccessControl(config);
    }
    return instance;
}

/** Test-only: install (or clear) an isolated instance. */
export function setFsAccessControlForTest(control: FsAccessControl | null): void {
    testInstance = control;
}
