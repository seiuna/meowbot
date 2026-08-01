/**
 * YAML frontmatter parsing + metadata validation for skill.md files.
 *
 * Uses js-yaml for real YAML support (arrays, booleans, quoted values) and Zod
 * (`SkillMetaSchema`) for validation, replacing the old line-splitting parser.
 */

import { load as yamlLoad } from "js-yaml";
import { SkillMetaSchema, type SkillCategory, type SkillMeta } from "./types.js";

export interface FrontmatterDoc {
    /** Parsed frontmatter fields (empty when absent or unparseable). */
    meta: Record<string, unknown>;
    /** Document body with the frontmatter block stripped. */
    body: string;
    /** YAML parse error, if any. */
    error?: string;
}

export function parseFrontmatter(raw: string): FrontmatterDoc {
    const normalized = raw.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
    if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };

    const endIdx = normalized.indexOf("\n---\n", 4);
    if (endIdx === -1) return { meta: {}, body: normalized };

    const header = normalized.slice(4, endIdx);
    const body = normalized.slice(endIdx + 5).trim();

    let meta: Record<string, unknown> = {};
    let error: string | undefined;
    try {
        const parsed = yamlLoad(header) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            meta = parsed as Record<string, unknown>;
        } else if (parsed !== undefined && parsed !== null) {
            error = "frontmatter must be a YAML mapping";
        }
    } catch (e: any) {
        error = "invalid YAML frontmatter: " + (e?.message ?? e);
    }

    return { meta, body, error };
}

export interface MetaBuildResult {
    meta: SkillMeta;
    /** Validation problems (invalid values are sanitized to the fallback). */
    errors: string[];
}

/**
 * Normalize legacy aliases (`required-providers`, `as-sub-agent`) and string
 * forms (comma lists, "false"/"no"/"0"), then validate with SkillMetaSchema.
 *
 * On validation failure the returned meta falls back to safe values instead of
 * throwing, so one broken skill cannot take down the whole registry.
 */
export function buildSkillMeta(
    raw: Record<string, unknown>,
    fallback: { name: string; category: SkillCategory; sourceDir?: string },
): MetaBuildResult {
    const errors: string[] = [];
    const normalized: Record<string, unknown> = { ...raw };

    if (normalized.requiredProviders === undefined && normalized["required-providers"] !== undefined) {
        normalized.requiredProviders = normalized["required-providers"];
    }
    if (normalized.asSubAgent === undefined && normalized["as-sub-agent"] !== undefined) {
        normalized.asSubAgent = normalized["as-sub-agent"];
    }

    if (typeof normalized.requiredProviders === "string") {
        normalized.requiredProviders = (normalized.requiredProviders as string)
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);
    }
    if (typeof normalized.asSubAgent === "string") {
        const v = (normalized.asSubAgent as string).trim().toLowerCase();
        normalized.asSubAgent = !["false", "no", "0"].includes(v);
    }

    const result = SkillMetaSchema.safeParse({ ...fallback, ...normalized });
    if (result.success) return { meta: result.data, errors };

    for (const issue of result.error.issues) {
        errors.push(`[${issue.path.join(".") || "meta"}] ${issue.message}`);
    }

    // Best-effort sanitized meta so the skill stays addressable.
    const meta: SkillMeta = {
        name: typeof raw.name === "string" && raw.name ? raw.name : fallback.name,
        description: typeof raw.description === "string" ? raw.description : "",
        requiredProviders: Array.isArray(normalized.requiredProviders)
            ? normalized.requiredProviders.filter((p): p is string => typeof p === "string")
            : [],
        asSubAgent: typeof normalized.asSubAgent === "boolean" ? normalized.asSubAgent : false,
        category: fallback.category,
        sourceDir: fallback.sourceDir,
        version: typeof raw.version === "string" ? raw.version : undefined,
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    };
    return { meta, errors };
}
