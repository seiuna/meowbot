/**
 * Skill — wraps a single skill folder (skill.md + info.json + few-shot.json).
 *
 * API:
 *   skill.prompt(data?)  → rendered prompt string
 *   skill.fewshot()      → BaseMessage[] (HumanMessage / AIMessage pairs)
 *   skill.meta           → SkillMeta (name, description, requiredProviders)
 */

import { HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { renderTemplate } from "./engine.js";
import { EnvTool } from "@meowbot/tools/tools.js";
import { DynamicStructuredTool, Tool } from "@langchain/core/tools";
import { toolRegistry } from "@meowbot/tools/tool_registry.js";

export interface SkillMeta {
    name: string;
    description: string;
    requiredProviders: string[];
    /** Whether this skill can be used as a sub-agent (appears in search_prompts results). */
    asSubAgent: boolean;
    /**
     * Category of this skill:
     *   "prompt"   — agent/sub-agent system prompts (with asSubAgent toggle)
     *   "skill"    — tool-providing skills (dynamic tool loading)
     *   "template" — message/env templates (${variable} interpolation)
     */
    category: "prompt" | "skill" | "template";
    /** Source path for debugging / reload. */
    sourceDir?: string;
}

export interface FewShotPair {
    human: string;
    ai: string;
}

export class Skill {
    public readonly meta: SkillMeta;
    private readonly rawPrompt: string;
    private readonly fewShotPairs: FewShotPair[];

    constructor(meta: SkillMeta, rawPrompt: string, fewShotPairs: FewShotPair[] = []) {
        this.meta = meta;
        this.rawPrompt = rawPrompt;
        this.fewShotPairs = fewShotPairs;
    }

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
     * Each pair in the JSON produces one HumanMessage + one AIMessage.
     */
    fewshot(): BaseMessage[] {
        const msgs: BaseMessage[] = [];
        for (const pair of this.fewShotPairs) {
            msgs.push(new HumanMessage({ content: pair.human }));
            msgs.push(new AIMessage({ content: pair.ai }));
        }
        return msgs;
    }

    tools(): DynamicStructuredTool[] {
        return toolRegistry.getToolsForProviders(this.meta.requiredProviders);
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
