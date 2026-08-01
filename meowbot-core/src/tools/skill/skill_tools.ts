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
import { getLogger } from "@meowbot/utils/logs.js";
import { searchSkills } from "./skill_search.js";

const logger = getLogger("SkillTools");

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
        const result = await searchSkills(query);
        return JSON.stringify({
            ok: true,
            query: result.query,
            count: result.results.length,
            mode: result.mode,
            skills: result.results,
        });
    },
);

// ── load_skill ──

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
            // Content comes from the SkillRegistry (single source of truth).
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
