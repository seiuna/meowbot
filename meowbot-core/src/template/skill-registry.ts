/**
 * SkillRegistry — unified skill store.
 *
 * Loads from three directories under project root:
 *   prompts/   — agent/sub-agent system prompts (with asSubAgent toggle)
 *   skills/    — tool-providing skills (dynamic tool loading)
 *   templates/ — message/env templates (${variable} interpolation)
 *
 * Also loads from each plugin's skills/ subdirectory (categorized as "skill").
 *
 * API:
 *   SkillRegistry.get(name)             → Skill | undefined
 *   SkillRegistry.list()                → string[] (all names)
 *   SkillRegistry.listPrompts()         → string[] (prompt names only)
 *   SkillRegistry.listSkills()          → string[] (skill names only)
 *   SkillRegistry.listTemplates()       → string[] (template names only)
 *   SkillRegistry.build(name, data)     → Promise<string>
 *   SkillRegistry.getMeta(name)         → { name, description, requiredProviders, asSubAgent, category }
 */

import { resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { toolRegistry } from "../tools/tool_registry.js";
import { Skill } from "./skill.js";
import { loadSkills } from "./skill-loader.js";
import { getLogger } from "../utils/logs.js";
import type { BaseMessage } from "@langchain/core/messages";

const logger = getLogger("SkillRegistry");

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SKILLS_DIR = resolve(ROOT, "skills");
const TEMPLATES_DIR = resolve(ROOT, "templates");
const PLUGINS_DIR = resolve(import.meta.dirname, "..", "plugin", "plugins");

class SkillRegistryStore {
    private skills: Map<string, Skill> | null = null;

    private async ensureLoaded(): Promise<Map<string, Skill>> {
        if (!this.skills) {
            const providers = toolRegistry.getProviders().map(p => p.getName());
            this.skills = new Map();

            // 1. Load skills/ (tool-providing)
            const skillDefs = await loadSkills(SKILLS_DIR, providers, "skill");
            for (const [k, v] of skillDefs) this.skills.set(k, v);

            // 2. Load templates/
            const templates = await loadSkills(TEMPLATES_DIR, providers, "template");
            for (const [k, v] of templates) this.skills.set(k, v);

            // 3. Load plugin skills/ (categorized as "skill")
            await this.loadPluginSkills(providers);
        }
        return this.skills;
    }

    /** Discover and load skill folders from each plugin's skills/ subdirectory. */
    private async loadPluginSkills(providers: string[]): Promise<void> {
        let pluginDirs: string[];
        try {
            pluginDirs = await readdir(PLUGINS_DIR);
        } catch {
            return; // No plugins directory
        }

        let loadedCount = 0;
        for (const pluginName of pluginDirs) {
            const pluginSkillsDir = join(PLUGINS_DIR, pluginName, "skills");
            let pluginStat;
            try {
                pluginStat = await stat(pluginSkillsDir);
            } catch {
                continue;
            }
            if (!pluginStat.isDirectory()) continue;

            const pluginSkills = await loadSkills(pluginSkillsDir, providers, "skill");
            for (const [k, v] of pluginSkills) {
                this.skills!.set(k, v);
                loadedCount++;
            }
        }

        if (loadedCount > 0) {
            logger.info(`Loaded ${loadedCount} plugin skill(s)`);
        }
    }

    /** Filter loaded skills by category. */
    private async listByCategory(category: "prompt" | "skill" | "template"): Promise<string[]> {
        const s = await this.ensureLoaded();
        return Array.from(s.values())
            .filter(skill => skill.meta.category === category)
            .map(skill => skill.meta.name);
    }

    // ── Skill access ──

    /** Get a Skill by name. */
    async get(name: string): Promise<Skill | undefined> {
        const s = await this.ensureLoaded();
        return s.get(name);
    }

    /** List all registered skill names (all categories). */
    async list(): Promise<string[]> {
        const s = await this.ensureLoaded();
        return Array.from(s.keys());
    }

    /** List prompt names only. */
    async listPrompts(): Promise<string[]> {
        return this.listByCategory("prompt");
    }

    /** List tool-providing skill names only. */
    async listSkills(): Promise<string[]> {
        return this.listByCategory("skill");
    }

    /** List template names only. */
    async listTemplates(): Promise<string[]> {
        return this.listByCategory("template");
    }

    /** Get raw prompt content by name (backward compat). */
    async getRaw(name: string): Promise<string | null> {
        const skill = await this.get(name);
        return skill ? skill.prompt() : null;
    }

    // ── Prompt building (backward-compatible) ──

    /**
     * Build a rendered prompt by skill name with optional data.
     * Same API as the old Prompts.build().
     * Works across all categories (prompts, skills, templates).
     */
    async build(name: string, data: Record<string, any>): Promise<string> {
        const skill = await this.get(name);
        if (!skill) {
            logger.warn(`Skill "${name}" not found`);
            return "";
        }
        return skill.prompt(data);
    }

    /** Alias for build(). */
    async prompt(name: string, data?: Record<string, any>): Promise<string> {
        return this.build(name, data ?? {});
    }

    // ── Few-shot ──

    /**
     * Get few-shot examples as LangChain BaseMessage[] for a skill.
     * Returns empty array if the skill has no few-shot.json.
     */
    async fewshot(name: string): Promise<BaseMessage[]> {
        const skill = await this.get(name);
        if (!skill) return [];
        return skill.fewshot();
    }

    // ── Metadata (backward compat) ──

    /** Get skill metadata (compatible with old getMeta, now includes category). */
    async getMeta(name: string): Promise<{
        name: string;
        description: string;
        requiredProviders: string[];
        asSubAgent: boolean;
        category: "prompt" | "skill" | "template";
    } | null> {
        const skill = await this.get(name);
        if (!skill) return null;
        return {
            name: skill.meta.name,
            description: skill.meta.description,
            requiredProviders: skill.meta.requiredProviders,
            asSubAgent: skill.meta.asSubAgent,
            category: skill.meta.category,
        };
    }

    // ── Lifecycle ──

    /** Reload all skills (e.g. after file changes). */
    async reload(): Promise<void> {
        this.skills = null;
        await this.ensureLoaded();
    }
}

/** Global skill registry singleton. */
export const SkillRegistry = new SkillRegistryStore();

/**
 * Backward-compatible export.
 * `Prompts.build(name, data)` works identically to the old API.
 */
export const Prompts = {
    build: (name: string, data: Record<string, any>) => SkillRegistry.build(name, data),
    list: () => SkillRegistry.list(),
    get: (name: string) => SkillRegistry.getRaw(name),
    getMeta: (name: string) => SkillRegistry.getMeta(name),
    reload: () => SkillRegistry.reload(),
};
