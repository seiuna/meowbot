/**
 * Skill tools — search and load skills from the skills/ directory.
 *
 * search_skill: find skills by name/description (vector + text hybrid)
 * load_skill:   read a skill file's full content
 */

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { defineEnvToolWithThought as defineTool } from "@meowbot/tools/tools.js";
import { IToolProvider } from "@meowbot/tools/tool_registry.js";
import { SkillRegistry } from "@meowbot/template/prompts.js";
import { getVectorRetriever } from "@meowbot/vector/index.js";
import { EmbeddingService } from "@meowbot/vector/embeddings.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getLogger } from "@meowbot/utils/logs.js";

const logger = getLogger("SkillTools");
const embedSvc = EmbeddingService.getInstance();

// ── search_skill ──

const searchSkillTool = defineTool(
    {
        name: "search_skill",
        description:
            "Search available skills by name or description. " +
            "Skills are reusable prompt templates and tool configurations. " +
            "Use this to discover skills you can load for specialized tasks.",
        schema: z.object({
            query: z.string().describe("Search keyword or natural language query"),
        }),
    },
    async ({ query }) => {
        const skills = await SkillRegistry.listSkills();
        const results: Array<{ name: string; description: string; providers: string[]; score?: number }> = [];

        // Try vector search first if enabled
        if (embedSvc.isEnabled) {
            try {
                const retriever = getVectorRetriever();
                const hits = await retriever.searchDocuments(query, 20);
                // Filter hits that match skill names
                for (const hit of hits) {
                    const meta = await SkillRegistry.getMeta(hit.docId.replace("skill:", ""));
                    if (meta && meta.category === "skill") {
                        results.push({
                            name: meta.name,
                            description: meta.description,
                            providers: meta.requiredProviders,
                            score: Math.round(hit.score * 100) / 100,
                        });
                    }
                    if (results.length >= 10) break;
                }
                if (results.length > 0) {
                    return JSON.stringify({ ok: true, query, count: results.length, mode: "vector", skills: results });
                }
            } catch (e) {
                logger.debug(`Skill vector search failed: ${e}`);
            }
        }

        // Text match fallback
        const q = query.toLowerCase();
        for (const name of skills) {
            const meta = await SkillRegistry.getMeta(name);
            if (!meta) continue;
            const matchName = name.toLowerCase().includes(q);
            const matchDesc = (meta.description || "").toLowerCase().includes(q);
            if (!matchName && !matchDesc) continue;
            results.push({
                name: meta.name,
                description: meta.description,
                providers: meta.requiredProviders,
            });
        }

        return JSON.stringify({ ok: true, query, count: results.length, mode: "text", skills: results });
    },
);

// ── load_skill ──

const SKILLS_DIR = resolve(import.meta.dirname, "..", "..", "..", "..", "skills");

const loadSkillTool = defineTool(
    {
        name: "load_skill",
        description:
            "Load a skill's full content. Pass the skill name from search_skill results. " +
            "Returns the complete skill prompt and metadata.",
        schema: z.object({
            skill_name: z.string().describe("Skill name from search_skill results"),
        }),
    },
    async ({ skill_name }) => {
        try {
            // Try to get from SkillRegistry first
            const skill = await SkillRegistry.get(skill_name);
            if (skill) {
                const content = skill.prompt();
                return JSON.stringify({
                    ok: true,
                    name: skill.meta.name,
                    description: skill.meta.description,
                    providers: skill.meta.requiredProviders,
                    category: skill.meta.category,
                    content,
                });
            }

            // Fallback: try reading the file directly
            const possiblePaths = [
                resolve(SKILLS_DIR, skill_name, "skill.md"),
                resolve(SKILLS_DIR, skill_name + ".md"),
            ];
            for (const p of possiblePaths) {
                if (existsSync(p)) {
                    const raw = readFileSync(p, "utf-8");
                    // Strip frontmatter
                    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
                    return JSON.stringify({ ok: true, name: skill_name, content: body });
                }
            }

            return JSON.stringify({ ok: false, error: `Skill "${skill_name}" not found. Use search_skill to find available skills.` });
        } catch (error: any) {
            return JSON.stringify({ ok: false, error: error.message });
        }
    },
);

// ── Provider ──

export class SkillToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [searchSkillTool, loadSkillTool];
    }

    pullAllTools(): DynamicStructuredTool[] { return this.tools; }
    getName(): string { return "Skill"; }
    getDescription(): string { return "Skill discovery — search and load ability templates"; }
}
