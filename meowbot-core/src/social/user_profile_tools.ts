import {z} from "zod";
import {DynamicStructuredTool} from "@langchain/core/tools";
import {defineEnvToolWithThought} from "@meowbot/tools/tools";
import {IToolProvider} from "@meowbot/tools/tool_registry";
import {UserProfileManager} from "@meowbot/social/user_profile_manager";

const profileManager = UserProfileManager.getInstance();

// ── Warmth Labels ──

function warmthToLabel(warmth: number): string {
    if (warmth >= 90) return "挚爱";
    if (warmth >= 75) return "亲密";
    if (warmth >= 60) return "友好";
    if (warmth >= 45) return "熟悉";
    if (warmth >= 30) return "普通";
    if (warmth >= 15) return "冷淡";
    return "敌意";
}

function warmthScaleDescription(): string {
    return "0-15: 敌意, 15-30: 冷淡, 30-45: 普通, 45-60: 熟悉, 60-75: 友好, 75-90: 亲密, 90-100: 挚爱";
}

// ── Tools ──

const getUserProfileTool = defineEnvToolWithThought(
    {
        name: "get_user_profile",
        description:
            "查询指定用户的画像资料，包括个性标签(tags)、性格简述(summary)、好感度(warmth)及对应的关系等级(warmth_label)。用于了解对话对象的偏好和历史印象。",
        schema: z.object({
            user_id: z.string().describe("要查询的用户唯一ID（QQ号等）"),
        }),
    },
    async ({user_id}) => {
        try {
            const profile = await profileManager.getUserProfile(user_id);
            if (!profile) {
                return JSON.stringify({
                    status: "not_found",
                    message: `用户 ${user_id} 暂无画像记录`,
                    data: null,
                });
            }
            const {warmthHistory, sessions, agent, ...visible} = profile.toObject();
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
                message: `查询用户画像失败: ${error.message}`,
            });
        }
    },
);

const updateUserProfileTool = defineEnvToolWithThought(
    {
        name: "update_user_profile",
        description:
            "更新或创建用户画像。所有字段均为可选，传入即更新对应字段。tags 为用户偏好/个性标签列表，summary 为性格肖像简述，warmth 为好感度指数(0-100)。修改 warmth 时建议填写 warmth_reason 说明原因，以便后续追溯。",
        schema: z.object({
            user_id: z.string().describe("用户唯一ID（QQ号等）"),
            tags: z
                .array(z.string())
                .optional()
                .describe("用户偏好或个性标签列表，如 [\"喜欢猫\", \"程序员\", \"内向\"]"),
            summary: z
                .string()
                .optional()
                .describe("用户性格肖像简述，一段话概括对用户的印象"),
            warmth: z
                .number()
                .min(0)
                .max(100)
                .optional()
                .describe("好感度指数(0-100)，越高代表越喜欢"),
            warmth_reason: z
                .string()
                .optional()
                .describe("修改好感度的原因，如 '用户帮助了别人' 或 '用户说了脏话'"),
        }),
    },
    async ({user_id, warmth_reason, warmth, ...updates}) => {
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

            const {warmthHistory, sessions, agent, ...visible} = profile.toObject();
            return JSON.stringify({
                status: "success",
                message: `用户 ${user_id} 画像已更新`,
                data: {
                    ...visible,
                    warmth_label: warmthToLabel(visible.warmth),
                    warmth_scale: warmthScaleDescription(),
                },
            });
        } catch (error: any) {
            return JSON.stringify({
                status: "error",
                message: `更新用户画像失败: ${error.message}`,
            });
        }
    },
);

const getWarmthHistoryTool = defineEnvToolWithThought(
    {
        name: "get_warmth_history",
        description:
            "查询指定用户的好感度变更历史记录（最新优先）。每次好感度变化的原因、变化前后的值都会记录。",
        schema: z.object({
            user_id: z.string().describe("要查询的用户唯一ID（QQ号等）"),
            limit: z
                .number()
                .int()
                .min(1)
                .max(5)
                .default(5)
                .describe("返回条数（1-5，默认5）"),
        }),
    },
    async ({user_id, limit}) => {
        try {
            const profile = await profileManager.getUserProfile(user_id);
            if (!profile) {
                return JSON.stringify({
                    status: "not_found",
                    message: `用户 ${user_id} 暂无画像记录`,
                    data: [],
                });
            }

            const history = profile.warmthHistory.slice(0, limit);
            if (history.length === 0) {
                return JSON.stringify({
                    status: "empty",
                    message: `用户 ${user_id} 暂无好感度变更记录`,
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
                message: `查询好感度历史失败: ${error.message}`,
            });
        }
    },
);

// ── Provider ──

export class UserProfileToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [getUserProfileTool, updateUserProfileTool, getWarmthHistoryTool];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "UserProfile";
    }

    getDescription(): string {
        return "用户画像管理工具 — 查询/更新画像、好感度变更历史追溯";
    }
}
