/**
 * SkillRegistry — unified skill store.
 *
 * Loads from three directories under project root (all configurable):
 *   prompts/    — agent/sub-agent system prompts (with asSubAgent toggle)
 *   skills/     — tool-providing skills (dynamic tool loading)
 *   templates/  — message/env templates (${variable} interpolation)
 *
 * Plugin skills are registered at runtime via `registerDynamic()` (wired to the
 * PluginContext.registerSkill hook) instead of scanning a hardcoded plugins dir.
 *
 * API:
 *   SkillRegistry.get(name)              → BaseSkill | undefined
 *   SkillRegistry.list()                 → string[] (all names)
 *   SkillRegistry.listPrompts()          → string[] (prompt names only)
 *   SkillRegistry.listSkills()           → string[] (skill names only)
 *   SkillRegistry.listTemplates()        → string[] (template names only)
 *   SkillRegistry.build(name, data)      → Promise<string>
 *   SkillRegistry.getMeta(name)          → { ...meta, content }
 *   SkillRegistry.reload()               → re-scan directories
 *   SkillRegistry.configure(...)         → inject custom roots (tests)
 *   SkillRegistry.getLoadErrors()        → problems collected during loading
 */

import { resolve } from "node:path";
import { toolRegistry } from "../tools/tool_registry.js";
import { BaseSkill } from "./skill.js";
import { loadSkillDirectory, loadSingleSkill } from "./skill-loader.js";
import type { SkillCategory } from "./types.js";
import { getLogger } from "../utils/logs.js";
import type { BaseMessage } from "@langchain/core/messages";

const logger = getLogger("SkillRegistry");

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

export interface SkillRegistryConfig {
    skillsDir: string;
    templatesDir: string;
    promptsDir: string;
}

const DEFAULT_CONFIG: SkillRegistryConfig = {
    skillsDir: resolve(ROOT, "skills"),
    templatesDir: resolve(ROOT, "templates"),
    promptsDir: resolve(ROOT, "prompts"),
};

class SkillRegistryStore {
    private skills: Map<string, BaseSkill> | null = null;
    /** Runtime-registered skills (plugin hooks). Survive reload(). */
    private dynamicSkills = new Map<string, BaseSkill>();
    private loadErrors: string[] = [];
    private config: SkillRegistryConfig = { ...DEFAULT_CONFIG };

    /** Replace the content roots (mainly for tests). Invalidates the cache. */
    public configure(config: Partial<SkillRegistryConfig>): void {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.skills = null;
        this.loadErrors = [];
        logger.info("SkillRegistry roots configured");
    }

    /**
     * Register a skill at runtime (used by the PluginContext.registerSkill hook).
     * Dynamic skills never override scanned ones; conflicts are logged.
     */
    public async registerDynamic(skill: BaseSkill): Promise<void> {
        this.dynamicSkills.set(skill.meta.name, skill);
        if (this.skills) {
            if (this.skills.has(skill.meta.name)) {
                logger.warn(`Dynamic skill "${skill.meta.name}" conflicts with a scanned skill; keeping the scanned one.`);
                return;
            }
            this.skills.set(skill.meta.name, skill);
        }
    }

    /** Load a plugin skill folder and register it dynamically. */
    public async loadPluginSkill(name: string, sourceDir: string, category: SkillCategory = "skill"): Promise<void> {
        const loaded = await loadSingleSkill(sourceDir, category);
        if (!loaded) throw new Error(`No skill.md found in ${sourceDir} (skill "${name}")`);
        for (const err of loaded.errors) {
            logger.warn(`Plugin skill "${name}" load problem: ${err}`);
        }
        await this.registerDynamic(loaded.skill);
    }

    private async ensureLoaded(): Promise<Map<string, BaseSkill>> {
        if (!this.skills) {
            this.skills = new Map();
            this.loadErrors = [];
            const providers = toolRegistry.getProviders().map(p => p.getName());

            const dirs: Array<[string, SkillCategory]> = [
                [this.config.skillsDir, "skill"],
                [this.config.templatesDir, "template"],
                [this.config.promptsDir, "prompt"],
            ];
            for (const [dir, category] of dirs) {
                const result = await loadSkillDirectory(dir, category, providers);
                for (const [k, v] of result.skills) this.addLoaded(k, v, "directory");
                this.loadErrors.push(...result.errors);
            }

            // Runtime-registered (plugin) skills — lowest priority.
            for (const [k, v] of this.dynamicSkills) this.addLoaded(k, v, "plugin");
        }
        return this.skills;
    }

    private addLoaded(name: string, skill: BaseSkill, source: string): void {
        if (this.skills!.has(name)) {
            logger.warn(`Duplicate skill "${name}" (${source}: ${skill.meta.sourceDir}) ignored`);
            this.loadErrors.push(`Duplicate skill "${name}" (${source})`);
            return;
        }
        this.skills!.set(name, skill);
    }

    /** Filter loaded skills by category. */
    private async listByCategory(category: SkillCategory): Promise<string[]> {
        const s = await this.ensureLoaded();
        return Array.from(s.values())
            .filter(skill => skill.meta.category === category)
            .map(skill => skill.meta.name);
    }

    // ── Skill access ──

    /** Get a skill by name (any category). */
    async get(name: string): Promise<BaseSkill | undefined> {
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

    /** Render a skill by name with optional data. Works across all categories. */
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

    /** Get few-shot examples as LangChain BaseMessage[] for a skill. */
    async fewshot(name: string): Promise<BaseMessage[]> {
        const skill = await this.get(name);
        if (!skill) return [];
        return skill.fewshot();
    }

    // ── Metadata (backward compat) ──

    /** Get skill metadata with rendered content. */
    async getMeta(name: string): Promise<{
        name: string;
        description: string;
        requiredProviders: string[];
        asSubAgent: boolean;
        category: SkillCategory;
        version?: string;
        tags: string[];
        sourceDir?: string;
        content: string;
    } | null> {
        const skill = await this.get(name);
        if (!skill) return null;
        return {
            name: skill.meta.name,
            description: skill.meta.description,
            requiredProviders: skill.meta.requiredProviders,
            asSubAgent: skill.meta.asSubAgent,
            category: skill.meta.category,
            version: skill.meta.version,
            tags: skill.meta.tags,
            sourceDir: skill.meta.sourceDir,
            content: skill.prompt(),
        };
    }

    // ── Lifecycle ──

    /** Reload all skills (e.g. after file changes). Dynamic skills survive. */
    async reload(): Promise<void> {
        this.skills = null;
        await this.ensureLoaded();
    }

    /** Problems collected during the last load (validation / duplicates). */
    getLoadErrors(): string[] {
        return [...this.loadErrors];
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
