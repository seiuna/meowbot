import { z } from "zod";

export const SKILL_CATEGORIES = ["prompt", "skill", "template"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/**
 * Validated metadata for any skill-like entry (prompt / tool-skill / template).
 *
 * - `prompt`    — agent/sub-agent system prompts (with asSubAgent toggle)
 * - `skill`     — tool-providing skills (dynamic tool loading)
 * - `template`  — message/env templates (${variable} interpolation)
 */
export const SkillMetaSchema = z.object({
    name: z.string().min(1, "name is required"),
    description: z.string().default(""),
    requiredProviders: z.array(z.string()).default([]),
    /** Whether this skill can be used as a sub-agent (appears in search_prompts results). */
    asSubAgent: z.boolean().default(false),
    category: z.enum(SKILL_CATEGORIES),
    /** Source path for debugging / reload. */
    sourceDir: z.string().optional(),
    version: z.string().optional(),
    tags: z.array(z.string()).default([]),
});
export type SkillMeta = z.infer<typeof SkillMetaSchema>;

export interface FewShotPair {
    human: string;
    ai: string;
}
