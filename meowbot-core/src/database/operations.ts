/**
 * MongoDB 更新操作 (使用 Mongoose)
 * 提供各种数据更新的方法
 */

import { UserProfileModel, SessionModel, MessageLogModel } from "./models.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("DBOperations");

/**
 * 更新用户好感度
 * @param userId - 用户ID
 * @param delta - 增减值
 */
export async function updateUserWarmth(userId: string, delta: number): Promise<number> {
    try {
        const profile = await UserProfileModel.findOneAndUpdate(
            { userId },
            {
                $inc: { warmth: delta },
                $set: { updatedAt: new Date() }
            },
            { upsert: true, new: true }
        ).lean();

        const newWarmth = profile?.warmth ?? 0;
        logger.info(`更新用户好感度: userId=${userId}, delta=${delta}, 新值=${newWarmth}`);
        return newWarmth;
    } catch (error) {
        logger.error(`更新用户好感度失败: ${error}`);
        throw error;
    }
}

/**
 * 更新用户信任度
 * @param userId - 用户ID
 * @param delta - 增减值
 */
export async function updateUserTrust(userId: string, delta: number): Promise<number> {
    try {
        const profile = await UserProfileModel.findOneAndUpdate(
            { userId },
            {
                $inc: { trust: delta },
                $set: { updatedAt: new Date() }
            },
            { upsert: true, new: true }
        ).lean();

        const newTrust = profile?.trust ?? 0;
        logger.info(`更新用户信任度: userId=${userId}, delta=${delta}, 新值=${newTrust}`);
        return newTrust;
    } catch (error) {
        logger.error(`更新用户信任度失败: ${error}`);
        throw error;
    }
}

/**
 * 添加用户标签
 * @param userId - 用户ID
 * @param tags - 要添加的标签数组
 */
export async function addUserTags(userId: string, tags: string[]): Promise<boolean> {
    try {
        const result = await UserProfileModel.updateOne(
            { userId },
            {
                $addToSet: { tags: { $each: tags } },
                $set: { updatedAt: new Date() }
            },
            { upsert: true }
        );

        logger.info(`添加用户标签: userId=${userId}, tags=${tags.join(",")}`);
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error(`添加用户标签失败: ${error}`);
        throw error;
    }
}

/**
 * 移除用户标签
 * @param userId - 用户ID
 * @param tags - 要移除的标签数组
 */
export async function removeUserTags(userId: string, tags: string[]): Promise<boolean> {
    try {
        const result = await UserProfileModel.updateOne(
            { userId },
            {
                $pull: { tags: { $in: tags } },
                $set: { updatedAt: new Date() }
            }
        );

        logger.info(`移除用户标签: userId=${userId}, tags=${tags.join(",")}`);
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error(`移除用户标签失败: ${error}`);
        throw error;
    }
}

/**
 * 更新用户总结
 * @param userId - 用户ID
 * @param summary - 新的总结内容
 */
export async function updateUserSummary(userId: string, summary: string): Promise<boolean> {
    try {
        const result = await UserProfileModel.updateOne(
            { userId },
            {
                $set: {
                    summary,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        logger.info(`更新用户总结: userId=${userId}`);
        return result.modifiedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
        logger.error(`更新用户总结失败: ${error}`);
        throw error;
    }
}

/**
 * 更新会话
 * @param threadId - 线程ID
 * @param updates - 更新的数据
 */
export async function updateSession(threadId: string, updates: Record<string, any>): Promise<boolean> {
    try {
        const result = await SessionModel.updateOne(
            { threadId },
            {
                $set: {
                    ...updates,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        logger.info(`更新会话: threadId=${threadId}`);
        return result.modifiedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
        logger.error(`更新会话失败: ${error}`);
        throw error;
    }
}

/**
 * 更新消息记录
 * @param messageId - 消息ID
 * @param updates - 更新的数据
 */
export async function updateMessageLog(messageId: string, updates: Record<string, any>): Promise<boolean> {
    try {
        const result = await MessageLogModel.updateOne(
            { messageId },
            {
                $set: {
                    ...updates,
                    updatedAt: new Date()
                }
            }
        );

        logger.info(`更新消息记录: messageId=${messageId}`);
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error(`更新消息记录失败: ${error}`);
        throw error;
    }
}

/**
 * 批量更新用户档案
 * @param filter - 筛选条件
 * @param updates - 更新的数据
 */
export async function updateUserProfileBatch(filter: Record<string, any>, updates: Record<string, any>): Promise<number> {
    try {
        const result = await UserProfileModel.updateMany(
            filter,
            {
                $set: {
                    ...updates,
                    updatedAt: new Date()
                }
            }
        );

        logger.info(`批量更新用户档案: 修改${result.modifiedCount}条记录`);
        return result.modifiedCount;
    } catch (error) {
        logger.error(`批量更新用户档案失败: ${error}`);
        throw error;
    }
}

/**
 * 增量更新用户多个字段
 * @param userId - 用户ID
 * @param increments - 要增加的字段和值
 */
export async function incrementUserFields(userId: string, increments: Record<string, number>): Promise<boolean> {
    try {
        const result = await UserProfileModel.updateOne(
            { userId },
            {
                $inc: increments,
                $set: { updatedAt: new Date() }
            },
            { upsert: true }
        );

        logger.info(`增量更新用户字段: userId=${userId}, increments=${JSON.stringify(increments)}`);
        return result.modifiedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
        logger.error(`增量更新用户字段失败: ${error}`);
        throw error;
    }
}
