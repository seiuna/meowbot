/**
 * MongoDB 查询操作 (使用 Mongoose)
 * 提供各种数据查询的方法
 */

import { UserProfileModel, SessionModel, MessageLogModel, IUserProfile, ISession, IMessageLog } from "./models.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("DBQueries");

/**
 * 获取用户的好感度
 * @param userId - 用户ID
 */
export async function getUserWarmth(userId: string): Promise<number> {
    try {
        const profile = await UserProfileModel.findOne({ userId }).select("warmth").lean();
        return profile?.warmth ?? 0;
    } catch (error) {
        logger.error(`获取用户好感度失败: ${error}`);
        throw error;
    }
}

/**
 * 获取用户的信任度
 * @param userId - 用户ID
 */
export async function getUserTrust(userId: string): Promise<number> {
    try {
        const profile = await UserProfileModel.findOne({ userId }).select("trust").lean();
        return profile?.trust ?? 0;
    } catch (error) {
        logger.error(`获取用户信任度失败: ${error}`);
        throw error;
    }
}

/**
 * 获取用户的标签列表
 * @param userId - 用户ID
 */
export async function getUserTags(userId: string): Promise<string[]> {
    try {
        const profile = await UserProfileModel.findOne({ userId }).select("tags").lean();
        return profile?.tags ?? [];
    } catch (error) {
        logger.error(`获取用户标签失败: ${error}`);
        throw error;
    }
}

/**
 * 根据会话ID获取会话
 * @param threadId - 线程ID
 */
export async function getSession(threadId: string): Promise<ISession | null> {
    try {
        return await SessionModel.findOne({ threadId }).lean();
    } catch (error) {
        logger.error(`获取会话失败: ${error}`);
        throw error;
    }
}

/**
 * 根据用户ID获取会话
 * @param userId - 用户ID
 */
export async function getSessionsByUserId(userId: string): Promise<ISession[]> {
    try {
        return await SessionModel.find({ userId }).lean();
    } catch (error) {
        logger.error(`获取用户会话失败: ${error}`);
        throw error;
    }
}

/**
 * 根据消息ID获取消息记录
 * @param messageId - 消息ID
 */
export async function getMessageLog(messageId: string): Promise<IMessageLog | null> {
    try {
        return await MessageLogModel.findOne({ messageId }).lean();
    } catch (error) {
        logger.error(`获取消息记录失败: ${error}`);
        throw error;
    }
}

/**
 * 根据用户ID获取消息记录
 * @param userId - 用户ID
 * @param limit - 返回条数
 */
export async function getMessageLogsByUserId(userId: string, limit: number = 100): Promise<IMessageLog[]> {
    try {
        return await MessageLogModel
            .find({ userId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();
    } catch (error) {
        logger.error(`获取用户消息记录失败: ${error}`);
        throw error;
    }
}

/**
 * 统计用户档案数量
 */
export async function countUserProfiles(): Promise<number> {
    try {
        return await UserProfileModel.countDocuments();
    } catch (error) {
        logger.error(`统计用户档案失败: ${error}`);
        throw error;
    }
}

/**
 * 统计会话数量
 */
export async function countSessions(): Promise<number> {
    try {
        return await SessionModel.countDocuments();
    } catch (error) {
        logger.error(`统计会话失败: ${error}`);
        throw error;
    }
}

/**
 * 检查用户是否存在
 * @param userId - 用户ID
 */
export async function userExists(userId: string): Promise<boolean> {
    try {
        const count = await UserProfileModel.countDocuments({ userId });
        return count > 0;
    } catch (error) {
        logger.error(`检查用户是否存在失败: ${error}`);
        throw error;
    }
}
