import {z} from "zod";
import {DynamicStructuredTool} from "@langchain/core/tools";
import {defineEnvToolWithThought} from "@meowbot/tools/tools";
import {IToolProvider} from "@meowbot/tools/tool_registry";
import {UserProfileManager} from "@meowbot/social/user_profile_manager";
import { VectorStore } from "../vector/store.js";
import { EmbeddingService } from "../vector/embeddings.js";

const profileManager = UserProfileManager.getInstance();
const embedSvc = EmbeddingService.getInstance();

// ── Warmth Labels ──

function warmthToLabel(warmth: number): string {
    if (warmth >= 90) return "Devoted";
    if (warmth >= 75) return "Intimate";
    if (warmth >= 60) return "Friendly";
    if (warmth >= 45) return "Familiar";
    if (warmth >= 30) return "Neutral";
    if (warmth >= 15) return "Cool";
    return "Hostile";
}

function warmthScaleDescription(): string {
    return "0-15: Hostile, 15-30: Cool, 30-45: Neutral, 45-60: Familiar, 60-75: Friendly, 75-90: Intimate, 90-100: Devoted";
}

// ── Tools ──

const getUserProfileTool = defineEnvToolWithThought(
    {
        name: "get_user_profile",
        description:
            "Get a user's profile: tags, summary, warmth score, and relationship level. Use this to understand who you're talking to and adjust your tone.",
        schema: z.object({
            user_id: z.string().describe("User's unique ID (e.g. QQ number)"),
        }),
    },
    async ({user_id}) => {
        try {
            const profile = await profileManager.getUserProfile(user_id);
            if (!profile) {
                return JSON.stringify({
                    status: "not_found",
                    message: `No profile found for user ${user_id}`,
                    data: null,
                });
            }
            const {warmthHistory, sessions, agent, ...visible} = profile as any;
            return JSON.stringify({
                status: "success",
                data: {
                    ...visible,
                    warmth_label: warmthToLabel(visible.warmth),
                    warmth_scale: warmthScaleDescription(),
                },
            });
        } catch (error: any) {
            return JSON.stringify({
                status: "error",
                message: `Failed to get profile: ${error.message}`,
            });
        }
    },
);

const updateUserProfileTool = defineEnvToolWithThought(
    {
        name: "update_user_profile",
        description:
            "Update or create a user profile. All fields optional — pass only what you want to change. Use warmth_reason when changing warmth for audit trail.",
        schema: z.object({
            user_id: z.string().describe("User's unique ID (e.g. QQ number)"),
            tags: z
                .array(z.string())
                .optional()
                .describe("Personality/preference tags, e.g. [\"likes cats\", \"programmer\"]"),
            summary: z
                .string()
                .optional()
                .describe("Brief character portrait / impression of the user"),
            warmth: z
                .number()
                .min(0)
                .max(100)
                .optional()
                .describe("Warmth/affinity score (0-100, higher = fonder)"),
            warmth_reason: z
                .string()
                .optional()
                .describe("Reason for warmth change, e.g. 'user helped someone' or 'user was rude'"),
        }),
    },
    async ({user_id, warmth_reason, warmth, ...updates}, runConfig) => {
        const session = (runConfig?.configurable as any)?.session;
        try {
            let profile;

            // If warmth is being updated, use updateWarmth for history tracking
            if (warmth !== undefined && warmth_reason) {
                profile = await profileManager.updateWarmth(user_id, warmth, warmth_reason);
                // Also update other fields if provided
                const otherUpdates: Record<string, any> = {};
                if (updates.tags) otherUpdates.tags = updates.tags;
                if (updates.summary) otherUpdates.summary = updates.summary;
                if (Object.keys(otherUpdates).length > 0) {
                    profile = await profileManager.updateProfile(user_id, otherUpdates);
                }
            } else {
                // General update
                const updateData: Record<string, any> = {...updates};
                if (warmth !== undefined) updateData.warmth = warmth;
                profile = await profileManager.updateProfile(user_id, updateData);
            }

            if (!profile) {
                // Create new profile if not exists
                profile = await profileManager.getOrCreateProfile(user_id, {
                    ...updates,
                    warmth: warmth ?? 0,
                });
            }

            const {warmthHistory, sessions, agent, ...visible} = profile as any;
            // Index for vector search
            await indexProfile(user_id, visible.tags ?? [], visible.summary);

            // Notify user
            session?.message?.([{ type: "text", data: "User memories has been updated!" }]);

            return JSON.stringify({
                status: "success",
                message: `Profile updated for ${user_id}`,
                data: {
                    ...visible,
                    warmth_label: warmthToLabel(visible.warmth),
                    warmth_scale: warmthScaleDescription(),
                },
            });
        } catch (error: any) {
            return JSON.stringify({
                status: "error",
                message: `Failed to update profile: ${error.message}`,
            });
        }
    },
);

const getWarmthHistoryTool = defineEnvToolWithThought(
    {
        name: "get_warmth_history",
        description:
            "Get the warmth change history for a user (most recent first). Each entry shows reason, from/to values.",
        schema: z.object({
            user_id: z.string().describe("User's unique ID"),
            limit: z
                .number()
                .int()
                .min(1)
                .max(5)
                .default(5)
                .describe("Number of records to return (1-5, default 5)"),
        }),
    },
    async ({user_id, limit}) => {
        try {
            const profile = await profileManager.getUserProfile(user_id);
            if (!profile) {
                return JSON.stringify({
                    status: "not_found",
                    message: `No profile found for user ${user_id}`,
                    data: [],
                });
            }

            const history = profile.warmthHistory.slice(0, limit);
            if (history.length === 0) {
                return JSON.stringify({
                    status: "empty",
                    message: `No warmth history for user ${user_id}`,
                    data: [],
                });
            }
            return JSON.stringify({
                status: "success",
                returned: history.length,
                limit,
                data: history,
            });
        } catch (error: any) {
            return JSON.stringify({
                status: "error",
                message: `Failed to get warmth history: ${error.message}`,
            });
        }
    },
);

// ── Memory tools (key:value tags + summary) ──

/** Convert tags+summary to a searchable text for vector index. */
function profileToText(tags: string[], summary?: string): string {
    const tagLine = tags.length ? `Tags: ${tags.join(", ")}. ` : "";
    const sumLine = summary ? `Summary: ${summary}` : "";
    return tagLine + sumLine;
}

/** Index a user profile into the vector store. */
async function indexProfile(userId: string, tags: string[], summary?: string): Promise<void> {
    if (!embedSvc.isEnabled) return;
    try {
        const store = VectorStore.getInstance();
        await store.upsert(`user:${userId}`, "user_memories", profileToText(tags, summary), { userId });
    } catch { /* non-fatal */ }
}

// ── get_user_memories ──

const getUserMemoriesTool = defineEnvToolWithThought(
    {
        name: "get_user_memories",
        description:
            "Get all memory tags (key:value format) and summary for a user. " +
            "Use this to recall what you already know about someone.",
        schema: z.object({
            user_id: z.string().describe("User's unique ID"),
        }),
    },
    async ({user_id}) => {
        try {
            const profile = await profileManager.getUserProfile(user_id);
            if (!profile) {
                return JSON.stringify({ status: "not_found", message: `No memories for user ${user_id}`, tags: [], summary: "" });
            }
            return JSON.stringify({
                status: "success",
                user_id,
                tags: profile.tags ?? [],
                summary: profile.summary ?? "",
            });
        } catch (error: any) {
            return JSON.stringify({ status: "error", message: error.message });
        }
    },
);

// ── update_user_memories ──

const updateUserMemoriesTool = defineEnvToolWithThought(
    {
        name: "update_user_memories",
        description:
            "Update user memories. Tags use key:value format (e.g. 'likes:cats', 'job:programmer'). " +
            "Pass add_tags to append, remove_tags to delete, summary to replace. All fields optional.",
        schema: z.object({
            user_id: z.string().describe("User's unique ID"),
            add_tags: z.array(z.string()).optional().describe("Tags to add, key:value format"),
            remove_tags: z.array(z.string()).optional().describe("Tags to remove"),
            summary: z.string().optional().describe("Character portrait / impression of the user"),
        }),
    },
    async ({user_id, add_tags, remove_tags, summary}, runConfig) => {
        const session = (runConfig?.configurable as any)?.session;
        try {
            let profile = await profileManager.getUserProfile(user_id);

            // Compute new tags
            let tags: string[] = profile?.tags?.slice() ?? [];

            if (add_tags && add_tags.length > 0) {
                for (const t of add_tags) {
                    // key:value — replace existing key, or add new
                    const colonIdx = t.indexOf(":");
                    if (colonIdx > 0) {
                        const key = t.substring(0, colonIdx);
                        tags = tags.filter(existing => !existing.startsWith(key + ":"));
                    }
                    tags.push(t);
                }
            }

            if (remove_tags && remove_tags.length > 0) {
                const removeSet = new Set(remove_tags);
                tags = tags.filter(t => !removeSet.has(t));
            }

            // Update
            const updates: Record<string, any> = { tags };
            if (summary !== undefined) updates.summary = summary;

            if (profile) {
                profile = await profileManager.updateProfile(user_id, updates);
            } else {
                profile = await profileManager.getOrCreateProfile(user_id, { tags, summary: summary ?? "" });
            }

            // Index for vector search
            await indexProfile(user_id, tags, summary ?? profile?.summary);

            // Notify user
            session?.message?.([{ type: "text", data: "User memories has been updated!" }]);

            return JSON.stringify({
                status: "success",
                user_id,
                tags: profile?.tags ?? tags,
                summary: profile?.summary ?? summary ?? "",
            });
        } catch (error: any) {
            return JSON.stringify({ status: "error", message: error.message });
        }
    },
);

// ── search_user_memories (only if embeddings enabled) ──

const searchUserMemoriesTool = defineEnvToolWithThought(
    {
        name: "search_user_memories",
        description:
            "Semantic search across all user memories. Input a natural language query, returns matching users with tags/summaries. " +
            "Use this to find users by traits or preferences. (Only available when vector search is enabled)",
        schema: z.object({
            query: z.string().describe("Natural language query, e.g. 'users who like cats' or 'frontend developers'"),
            top_k: z.number().int().min(1).max(10).default(5).describe("Number of results to return"),
        }),
    },
    async ({query, top_k}) => {
        if (!embedSvc.isEnabled) {
            return JSON.stringify({ status: "disabled", message: "Vector search is not enabled" });
        }
        try {
            const store = VectorStore.getInstance();
            const results = await store.search(query, "user_memories", top_k);
            if (results.length === 0) {
                return JSON.stringify({ status: "empty", query, results: [] });
            }
            const data = results.map(r => ({
                user_id: r.metadata?.userId ?? r.docId.replace("user:", ""),
                text: r.text,
                score: Math.round(r.score * 100) / 100,
            }));
            return JSON.stringify({ status: "success", query, count: data.length, results: data });
        } catch (error: any) {
            return JSON.stringify({ status: "error", message: error.message });
        }
    },
);

// ── truncate_user_memories ──

const truncateUserMemoriesTool = defineEnvToolWithThought(
    {
        name: "truncate_user_memories",
        description:
            "Truncate user memory tags, keeping only the most recent max_tags (default 20). " +
            "Call this yourself when tags accumulate too many.",
        schema: z.object({
            user_id: z.string().describe("User's unique ID"),
            max_tags: z.number().int().min(1).default(20).describe("Max tags to keep (default 20)"),
        }),
    },
    async ({user_id, max_tags}) => {
        try {
            const profile = await profileManager.getUserProfile(user_id);
            if (!profile) {
                return JSON.stringify({ status: "not_found", message: `No memories for user ${user_id}` });
            }
            if (profile.tags.length <= max_tags) {
                return JSON.stringify({ status: "no_op", message: `Tag count ${profile.tags.length} within limit ${max_tags}` });
            }
            // Keep most recent tags (they're appended to the end)
            const kept = profile.tags.slice(-max_tags);
            await profileManager.updateProfile(user_id, { tags: kept });
            return JSON.stringify({
                status: "success",
                user_id,
                removed: profile.tags.length - kept.length,
                kept: kept.length,
                message: `Removed ${profile.tags.length - kept.length} old tags, kept ${kept.length}`,
            });
        } catch (error: any) {
            return JSON.stringify({ status: "error", message: error.message });
        }
    },
);

// ── Provider ──

export class UserProfileToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        const base = [
            getUserProfileTool,
            updateUserProfileTool,
            getWarmthHistoryTool,
            getUserMemoriesTool,
            updateUserMemoriesTool,
            truncateUserMemoriesTool,
        ];
        // Only add vector search if embeddings are enabled
        if (embedSvc.isEnabled) {
            base.push(searchUserMemoriesTool);
        }
        this.tools = base;
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "UserProfile";
    }

    getDescription(): string {
        return "User profile & memory management — tags, summary, warmth, memory search";
    }
}
