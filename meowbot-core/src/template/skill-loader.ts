/**
 * Skill folder loader.
 *
 * Scans a directory for skill entries. Each entry is either:
 *   - a subdirectory containing skill.md (required) + few-shot.json (optional)
 *   - a flat `[name].md` file with YAML frontmatter + body
 *
 * Metadata comes exclusively from skill.md YAML frontmatter (js-yaml), validated
 * by `SkillMetaSchema`. Broken entries are collected in `errors` instead of
 * being silently dropped or crashing the whole load.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { getLogger } from "../utils/logs.js";
import { BaseSkill, Skill, Template } from "./skill.js";
import { parseFrontmatter, buildSkillMeta } from "./frontmatter.js";
import type { SkillCategory, SkillMeta, FewShotPair } from "./types.js";

const logger = getLogger("SkillLoader");

export interface LoadResult {
    skills: Map<string, BaseSkill>;
    /** Load/validation problems (one entry per problem). */
    errors: string[];
}

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

function makeSkillInstance(meta: SkillMeta, body: string, fewShot: FewShotPair[]): BaseSkill {
    return meta.category === "template"
        ? new Template(meta, body, fewShot)
        : new Skill(meta, body, fewShot);
}

/**
 * Load a single skill from a directory containing skill.md.
 *
 * @param dirPath   - Directory that contains skill.md (folder-per-skill).
 * @param category  - Category tag for the skill.
 * @param providers - Registered tool provider names (for warnings only).
 */
export async function loadSingleSkill(
    dirPath: string,
    category: SkillCategory = "skill",
    providers?: string[],
): Promise<{ skill: BaseSkill; errors: string[] } | null> {
    const folderName = basename(dirPath);

    let rawPrompt: string;
    try {
        rawPrompt = await readFile(join(dirPath, "skill.md"), "utf-8");
    } catch {
        logger.debug(`Skipping ${folderName}: no skill.md found`);
        return null;
    }

    const errors: string[] = [];
    const doc = parseFrontmatter(rawPrompt);
    if (doc.error) errors.push(`[${folderName}] ${doc.error}`);

    const frontName = typeof doc.meta.name === "string" && doc.meta.name
        ? doc.meta.name
        : folderName.toLowerCase().replace(/[_-]/g, "-");
    const { meta, errors: metaErrors } = buildSkillMeta(doc.meta, {
        name: frontName,
        category,
        sourceDir: dirPath,
    });
    for (const err of metaErrors) errors.push(`[${folderName}] ${err}`);

    if (meta.requiredProviders.length > 0 && providers) {
        for (const p of meta.requiredProviders) {
            if (!providers.includes(p)) {
                logger.warn(`Skill "${meta.name}" requires provider "${p}" which is NOT registered`);
            }
        }
    }

    // Templates are pure rendering entries — no few-shot support.
    const fewShot = category === "template" ? [] : await loadFewShot(dirPath);
    const skill = makeSkillInstance(meta, doc.body, fewShot);
    logger.debug(
        `Loaded ${category} "${meta.name}" from ${folderName}` +
        (meta.description ? ` desc="${meta.description.substring(0, 40)}"` : "") +
        (meta.requiredProviders.length ? ` providers=[${meta.requiredProviders.join(",")}]` : "") +
        (fewShot.length ? ` few-shot=${fewShot.length}` : ""),
    );
    return { skill, errors };
}

/**
 * Scan a directory for skill entries (folders with skill.md, flat .md files).
 */
export async function loadSkillDirectory(
    dirPath: string,
    category: SkillCategory = "skill",
    providers?: string[],
): Promise<LoadResult> {
    const result: LoadResult = { skills: new Map(), errors: [] };
    const absDir = resolve(dirPath);

    let entries: string[];
    try {
        entries = await readdir(absDir);
    } catch {
        logger.debug(`Skill directory not found: ${absDir}`);
        return result;
    }

    for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const entryPath = join(absDir, entry);

        let entryStat;
        try {
            entryStat = await stat(entryPath);
        } catch {
            continue;
        }

        if (entryStat.isDirectory()) {
            const loaded = await loadSingleSkill(entryPath, category, providers);
            if (loaded) addUnique(result, loaded.skill, loaded.errors);
        } else if (entry.toLowerCase().endsWith(".md")) {
            const raw = await readFile(entryPath, "utf-8");
            const doc = parseFrontmatter(raw);
            const errors: string[] = [];
            if (doc.error) errors.push(`[${entry}] ${doc.error}`);

            const flatName = entry.replace(/\.md$/i, "");
            const frontName = typeof doc.meta.name === "string" && doc.meta.name
                ? doc.meta.name
                : flatName;
            const { meta, errors: metaErrors } = buildSkillMeta(doc.meta, {
                name: frontName,
                category,
                sourceDir: entryPath,
            });
            for (const err of metaErrors) errors.push(`[${entry}] ${err}`);

            addUnique(result, makeSkillInstance(meta, doc.body, []), errors);
        }
    }

    logger.info(
        `Loaded ${result.skills.size} ${category}(s) from ${absDir}` +
        (result.errors.length ? ` (${result.errors.length} problem(s))` : ""),
    );
    return result;
}

function addUnique(result: LoadResult, skill: BaseSkill, errors: string[]): void {
    result.errors.push(...errors);
    if (result.skills.has(skill.meta.name)) {
        result.errors.push(`Duplicate skill name "${skill.meta.name}" (${skill.meta.sourceDir})`);
        return;
    }
    result.skills.set(skill.meta.name, skill);
}
