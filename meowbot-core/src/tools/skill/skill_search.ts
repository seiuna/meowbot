/**
 * Skill search service — vector-first, text-fallback search over skills.
 *
 * Extracted from the search_skill tool so the same hybrid search can be reused
 * by other callers (e.g. sub-agent resolution, autocomplete, MCP bridges).
 */

import { SkillRegistry } from "@meowbot/template/prompts.js";
import { getVectorRetriever } from "@meowbot/vector/index.js";
import { EmbeddingService } from "@meowbot/vector/embeddings.js";
import { getLogger } from "@meowbot/utils/logs.js";
import type { SkillCategory } from "@meowbot/template/types.js";

const logger = getLogger("SkillSearch");

export interface SkillSearchResult {
    name: string;
    description: string;
    providers: string[];
    tools: string[];
    score?: number;
}

export interface SkillSearchResponse {
    query: string;
    mode: "vector" | "text";
    results: SkillSearchResult[];
}

export interface SkillSearchOptions {
    /** Restrict to a category (default "skill"). */
    category?: SkillCategory;
    /** Max results (default: vector 10, text all). */
    limit?: number;
}

/**
 * Search skills by name/description.
 *
 * Tries vector search (namespace "skills") first when embeddings are enabled;
 * falls back to case-insensitive substring matching on name/description.
 */
export async function searchSkills(
    query: string,
    options: SkillSearchOptions = {},
): Promise<SkillSearchResponse> {
    const category = options.category ?? "skill";
    const limit = options.limit;

    // Vector branch
    if (EmbeddingService.getInstance().isEnabled) {
        try {
            const hits = await getVectorRetriever().searchSkills(query, 20);
            const results: SkillSearchResult[] = [];
            for (const hit of hits) {
                const meta = await SkillRegistry.getMeta(hit.docId.replace(/^skill:/, ""));
                if (meta && meta.category === category) {
                    results.push({
                        name: meta.name,
                        description: meta.description,
                        providers: meta.requiredProviders,
                        tools: meta.tools,
                        score: Math.round(hit.score * 100) / 100,
                    });
                }
                if (results.length >= (limit ?? 10)) break;
            }
            if (results.length > 0) {
                return { query, mode: "vector", results };
            }
        } catch (e) {
            logger.debug(`Skill vector search failed: ${e}`);
        }
    }

    // Text fallback
    const q = query.toLowerCase();
    const results: SkillSearchResult[] = [];
    for (const name of await SkillRegistry.list()) {
        const meta = await SkillRegistry.getMeta(name);
        if (!meta || meta.category !== category) continue;
        const matchName = name.toLowerCase().includes(q);
        const matchDesc = (meta.description || "").toLowerCase().includes(q);
        if (!matchName && !matchDesc) continue;
        results.push({
            name: meta.name,
            description: meta.description,
            providers: meta.requiredProviders,
            tools: meta.tools,
        });
        if (limit && results.length >= limit) break;
    }
    return { query, mode: "text", results };
}
