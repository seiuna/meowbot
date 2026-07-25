/**
 * MongoDB 删除操作 (使用 Mongoose)
 * 提供各种数据删除的方法
 */

import { UserProfileModel, SessionModel, MessageLogModel } from "./models.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("DBDelete");

/**
 * 删除用户档案
 * @param userId - 用户ID
 */
export async function deleteUserProfile(userId: string): Promise<boolean> {
    try {
        const result = await UserProfileModel.deleteOne({ userId });
        logger.info(`删除用户档案: userId=${userId}, 删除${result.deletedCount}条`);
        return result.deletedCount > 0;
    } catch (error) {
        logger.error(`删除用户档案失败: ${error}`);
        throw error;
    }
}

/**
 * 删除会话
 * @param threadId - 线程ID
 */
export async function deleteSession(threadId: string): Promise<boolean> {
    try {
        const result = await SessionModel.deleteOne({ threadId });
        logger.info(`删除会话: threadId=${threadId}, 删除${result.deletedCount}条`);
        return result.deletedCount > 0;
    } catch (error) {
        logger.error(`删除会话失败: ${error}`);
        throw error;
    }
}

/**
 * 删除消息记录
 * @param messageId - 消息ID
 */
export async function deleteMessageLog(messageId: string): Promise<boolean> {
    try {
        const result = await MessageLogModel.deleteOne({ messageId });
        logger.info(`删除消息记录: messageId=${messageId}, 删除${result.deletedCount}条`);
        return result.deletedCount > 0;
    } catch (error) {
        logger.error(`删除消息记录失败: ${error}`);
        throw error;
    }
}

/**
 * 批量删除用户档案 (按条件)
 * @param filter - 删除条件
 */
export async function deleteUserProfilesBatch(filter: Record<string, any>): Promise<number> {
    try {
        const result = await UserProfileModel.deleteMany(filter);
        logger.info(`批量删除用户档案: 删除${result.deletedCount}条`);
        return result.deletedCount;
    } catch (error) {
        logger.error(`批量删除用户档案失败: ${error}`);
        throw error;
    }
}

/**
 * 按时间删除过期会话 (在 TTL 索引外额外清理)
 * @param beforeDate - 删除此日期之前的会话
 */
export async function deleteOldSessions(beforeDate: Date): Promise<number> {
    try {
        const result = await SessionModel.deleteMany({
            createdAt: { $lt: beforeDate }
        });

        logger.info(`删除过期会话: 删除${result.deletedCount}条`);
        return result.deletedCount;
    } catch (error) {
        logger.error(`删除过期会话失败: ${error}`);
        throw error;
    }
}

/**
 * 按时间删除过期消息记录
 * @param beforeDate - 删除此日期之前的消息
 */
export async function deleteOldMessageLogs(beforeDate: Date): Promise<number> {
    try {
        const result = await MessageLogModel.deleteMany({
            timestamp: { $lt: beforeDate }
        });

        logger.info(`删除过期消息记录: 删除${result.deletedCount}条`);
        return result.deletedCount;
    } catch (error) {
        logger.error(`删除过期消息记录失败: ${error}`);
        throw error;
    }
}

/**
 * 清空集合 (危险操作，谨慎使用)
 * @param modelName - 模型名称
 */
export async function clearCollection(modelName: string): Promise<number> {
    try {
        let model: any;
        switch (modelName) {
            case "user_profiles":
                model = UserProfileModel;
                break;
            case "sessions":
                model = SessionModel;
                break;
            case "message_logs":
                model = MessageLogModel;
                break;
            default:
                throw new Error(`未知的模型名称: ${modelName}`);
        }

        const result = await model.deleteMany({});
        logger.warn(`清空集合 '${modelName}': 删除${result.deletedCount}条`);
        return result.deletedCount;
    } catch (error) {
        logger.error(`清空集合失败: ${error}`);
        throw error;
    }
}
