/**
 * MongoDB 初始化入口
 * 在应用启动时调用此函数完整初始化数据库
 */

import { getMongoDBClient } from "./mongodb.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("DBInit");

/**
 * 初始化数据库
 * - 建立 MongoDB 连接 (Mongoose)
 * - 进行健康检查
 */
export async function bootstrapDatabase(): Promise<void> {
    const mongoClient = getMongoDBClient();
    await mongoClient.initialize();
    await performHealthCheck();
}

/**
 * 数据库健康检查
 */
async function performHealthCheck(): Promise<void> {
    const mongoClient = getMongoDBClient();

    if (!mongoClient.isReady()) {
        throw new Error("MongoDB 连接未就绪");
    }

    const mongoose = mongoClient.getMongoose();
    const db = mongoose.connection.db;

    if (!db) {
        throw new Error("无法获取数据库实例");
    }

    const collections = await db.listCollections().toArray();

    logger.info("数据库集合:");
    collections.forEach((col: any) => {
        logger.info(`   - ${col.name}`);
    });
}

/**
 * 关闭数据库连接
 * 在应用关闭时调用
 */
export async function shutdownDatabase(): Promise<void> {
    const mongoClient = getMongoDBClient();
    await mongoClient.disconnect();
}
