/**
 * Skill folder loader.
 *
 * Scans a directory for skill subdirectories. Each subdirectory must contain:
 *   - skill.md      (required) — prompt content (may include YAML frontmatter)
 *   - info.json     (optional) — metadata: name, description, requiredProviders
 *   - few-shot.json (optional) — few-shot pairs: [{"human":"...","ai":"..."},...]
 *
 * Metadata resolution priority:
 *   1. info.json (if present, fully authoritative)
 *   2. YAML frontmatter in skill.md (legacy fallback)
 *   3. Folder name as skill name (last resort)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { getLogger } from "../utils/logs.js";
import { Skill, type SkillMeta, type FewShotPair } from "./skill.js";

const logger = getLogger("SkillLoader");

// ── YAML frontmatter parser (simple, dependency-free) ──

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
    const meta: Record<string, string> = {};
    let body = raw;
    const normalized = raw.replace(/\r\n/g, "\n");

    if (normalized.startsWith("---\n")) {
        const endIdx = normalized.indexOf("\n---\n", 4);
        if (endIdx !== -1) {
            const header = normalized.slice(4, endIdx);
            body = normalized.slice(endIdx + 5).trim();
            for (const line of header.split("\n")) {
                const colonIdx = line.indexOf(":");
                if (colonIdx > 0) {
                    const key = line.slice(0, colonIdx).trim();
                    const value = line.slice(colonIdx + 1).trim();
                    meta[key] = value;
                }
            }
        }
    }
    return { meta, body };
}

// ── info.json loading (deprecated — prefer skill.md frontmatter) ──

/** @deprecated Metadata should live in skill.md YAML frontmatter. */
interface SkillInfoJson {
    name?: string;
    description?: string;
    requiredProviders?: string[];
    asSubAgent?: boolean;
}

async function loadInfoJson(dirPath: string): Promise<SkillInfoJson | null> {
    try {
        const raw = await readFile(join(dirPath, "info.json"), "utf-8");
        return JSON.parse(raw) as SkillInfoJson;
    } catch {
        return null;
    }
}

// ── few-shot.json loading ──

async function loadFewShot(dirPath: string): Promise<FewShotPair[]> {
    try {
        const raw = await readFile(join(dirPath, "few-shot.json"), "utf-8");
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((p: any) => typeof p.human === "string" && typeof p.ai === "string")
            .map((p: any) => ({ human: p.human, ai: p.ai }));
    } catch {
        return [];
    }
}

// ── Public API ──

/**
 * Load all skill folders from a directory.
 *
 * @param dirPath     - Path to scan for skill subdirectories.
 * @param providers   - Optional list of registered tool provider names for validation.
 * @param category    - Category tag for all loaded skills ("prompt", "skill", or "template").
 * @returns Map of skill name → Skill instance.
 */
export async function loadSkills(
    dirPath: string,
    providers?: string[],
    category: "prompt" | "skill" | "template" = "skill",
): Promise<Map<string, Skill>> {
    const skills = new Map<string, Skill>();
    const absDir = resolve(dirPath);

    let entries: string[];
    try {
        entries = await readdir(absDir);
    } catch {
        logger.info(`Skill directory not found: ${absDir}`);
        return skills;
    }

    for (const entry of entries) {
        const entryPath = join(absDir, entry);
        let entryStat;
        try {
            entryStat = await stat(entryPath);
        } catch {
            continue;
        }
        if (!entryStat.isDirectory()) continue;
        // Skip hidden folders
        if (entry.startsWith(".")) continue;

        const skill = await loadSingleSkill(entryPath, providers, category);
        if (skill) {
            // If name collision, last-loaded wins (consistent with previous behavior)
            skills.set(skill.meta.name, skill);
        }
    }

    logger.info(`Loaded ${skills.size} ${category}(s) from ${absDir}`);
    return skills;
}

/**
 * Load a single skill from a directory.
 */
export async function loadSingleSkill(
    dirPath: string,
    providers?: string[],
    category: "prompt" | "skill" | "template" = "skill",
): Promise<Skill | null> {
    const folderName = basename(dirPath);

    // 1. Read skill.md (required)
    let rawPrompt: string;
    try {
        rawPrompt = await readFile(join(dirPath, "skill.md"), "utf-8");
    } catch {
        logger.debug(`Skipping ${folderName}: no skill.md found`);
        return null;
    }

    // 2. Load metadata: frontmatter > info.json (fallback) > folder name
    const infoJson = await loadInfoJson(dirPath);
    const frontmatter = parseFrontmatter(rawPrompt);

    const name = frontmatter.meta.name
        || infoJson?.name
        || folderName.toLowerCase().replace(/[_-]/g, "-");

    const description = frontmatter.meta.description
        || infoJson?.description
        || "";

    const reqProvidersRaw = frontmatter.meta["required-providers"] || frontmatter.meta.requiredProviders
        || (infoJson?.requiredProviders ? infoJson.requiredProviders.join(",") : "")
        || "";
    const requiredProviders = reqProvidersRaw
        ? reqProvidersRaw.split(",").map(s => s.trim()).filter(Boolean)
        : [];

    // asSubAgent: frontmatter first, then info.json, default true
    const asSubAgentRaw = frontmatter.meta["as-sub-agent"]
        || (infoJson?.asSubAgent !== undefined ? String(infoJson.asSubAgent) : "");
    const asSubAgent = asSubAgentRaw ? asSubAgentRaw.toLowerCase() !== "false" : true;

    // If info.json was used as fallback for anything, warn (it's deprecated)
    if (infoJson && (infoJson.name || infoJson.description || infoJson.requiredProviders)) {
        logger.warn(
            `Skill "${name}" has info.json with metadata. ` +
            `Move all metadata to skill.md frontmatter and delete info.json.`
        );
    }

    // 3. Validate providers
    if (requiredProviders.length > 0 && providers) {
        for (const p of requiredProviders) {
            if (!providers.includes(p)) {
                logger.warn(`Skill "${name}" requires provider "${p}" which is NOT registered`);
            }
        }
    }

    // 4. Strip frontmatter from prompt body always (metadata lives in frontmatter now)
    const promptBody = frontmatter.body;

    // 5. Load few-shot
    const fewShot = await loadFewShot(dirPath);

    const meta: SkillMeta = { name, description, requiredProviders, asSubAgent, category, sourceDir: dirPath };
    logger.debug(`Loaded ${category} "${name}" from ${folderName}` +
        (description ? ` desc="${description.substring(0, 40)}"` : "") +
        (requiredProviders.length ? ` providers=[${requiredProviders.join(",")}]` : "") +
        (fewShot.length ? ` few-shot=${fewShot.length}` : ""));

    return new Skill(meta, promptBody, fewShot);
}
