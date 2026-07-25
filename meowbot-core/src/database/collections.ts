/**
 * MongoDB 集合初始化 (使用 Mongoose)
 * Mongoose 会根据 Schema 自动创建集合和索引
 * 此文件主要用于手动触发索引构建
 */

import { UserProfileModel, SessionModel, MessageLogModel } from "./models.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("Collections");

/**
 * 初始化所有集合索引
 * Mongoose 会在首次连接时自动创建索引，但可以手动触发
 */
export async function initializeCollections(): Promise<void> {
    try {
        logger.info("正在初始化数据库索引...");

        // 确保所有索引都已创建
        await Promise.all([
            UserProfileModel.createIndexes(),
            SessionModel.createIndexes(),
            MessageLogModel.createIndexes(),
        ]);

        logger.info("数据库索引初始化完成");
    } catch (error) {
        logger.error(`Failed to initialize collections: ${error}`);
        throw error;
    }
}
