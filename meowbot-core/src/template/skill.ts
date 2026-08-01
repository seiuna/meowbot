/**
 * Skill model — wraps a single skill folder (skill.md + few-shot.json).
 *
 * API:
 *   skill.prompt(data?)  → rendered prompt string
 *   skill.fewshot()      → BaseMessage[] (HumanMessage / AIMessage pairs)
 *   skill.meta           → SkillMeta (validated, see types.ts)
 *
 * Domain split:
 *   BaseSkill  — shared rendering / few-shot behavior
 *   Skill      — tool-providing skills (prompts + skills categories)
 *   Template   — pure message/env templates (no tools, render() alias)
 */

import { HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { renderTemplate } from "./engine.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { toolRegistry } from "@meowbot/tools/tool_registry.js";
import type { SkillMeta, FewShotPair } from "./types.js";

export abstract class BaseSkill {
    constructor(
        public readonly meta: SkillMeta,
        protected readonly rawPrompt: string,
        protected readonly fewShotPairs: FewShotPair[] = [],
    ) {}

    /**
     * Render the skill prompt with optional template data.
     * Supports `${variable}` interpolation via the engine.
     */
    prompt(data?: Record<string, unknown>): string {
        if (!data || Object.keys(data).length === 0) return this.rawPrompt;
        return renderTemplate(this.rawPrompt, data as Record<string, any>);
    }

    /**
     * Return few-shot examples as LangChain HumanMessage/AIMessage pairs.
     */
    fewshot(): BaseMessage[] {
        const msgs: BaseMessage[] = [];
        for (const pair of this.fewShotPairs) {
            msgs.push(new HumanMessage({ content: pair.human }));
            msgs.push(new AIMessage({ content: pair.ai }));
        }
        return msgs;
    }

    /** Whether this skill has few-shot examples. */
    get hasFewShot(): boolean {
        return this.fewShotPairs.length > 0;
    }

    /** Number of few-shot pairs. */
    get fewShotCount(): number {
        return this.fewShotPairs.length;
    }
}

/** Tool-providing skill (categories: "prompt", "skill"). */
export class Skill extends BaseSkill {
    /**
     * Resolve tools lazily at call time so providers registered after the
     * skill was loaded are still included.
     *
     * Binding order:
     *   1. `tools` frontmatter — exact tool names via ToolRegistry.getToolsByName()
     *   2. `required-providers` (legacy) — all tools from the named providers
     */
    tools(): DynamicStructuredTool[] {
        if (this.meta.tools.length > 0) {
            return toolRegistry.getToolsByName(this.meta.tools);
        }
        return toolRegistry.getToolsForProviders(this.meta.requiredProviders);
    }
}

/** Pure message/env template (category: "template"). No tools / few-shot. */
export class Template extends BaseSkill {
    render(data?: Record<string, unknown>): string {
        return this.prompt(data);
    }
}

// Backward-compatible type re-exports (deep imports of ./skill.js keep working).
export type { SkillMeta, FewShotPair, SkillCategory } from "./types.js";
