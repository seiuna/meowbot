/**
 * MongoDB 连接管理 (使用 Mongoose)
 */

import mongoose from "mongoose";
import { mongoDBConfig } from "../config/app-config.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("MongoDB");

export class MongoDBClient {
    private static instance: MongoDBClient;
    private isConnected: boolean = false;

    private constructor() {}

    /**
     * 获取 MongoDBClient 单例实例
     */
    public static getInstance(): MongoDBClient {
        if (!MongoDBClient.instance) {
            MongoDBClient.instance = new MongoDBClient();
        }
        return MongoDBClient.instance;
    }

    /**
     * 初始化 MongoDB 连接
     */
    public async initialize(): Promise<void> {
        if (this.isConnected) {
            logger.info("MongoDB 已连接，跳过初始化");
            return;
        }

        try {
            const config = mongoDBConfig;
            const connectionString = this.buildConnectionString(config);

            const maskedHost = `${config.host}:${config.port}/${config.database}`;
            logger.info(`Connecting to MongoDB: ${maskedHost}`);

            const options: mongoose.ConnectOptions = {
                connectTimeoutMS: 10000,
                serverSelectionTimeoutMS: 5000,
            };

            if (config.username && config.password) {
                options.authSource = config.authSource || "admin";
            }

            await mongoose.connect(connectionString, options);

            this.isConnected = true;

            // 监听连接事件
            mongoose.connection.on("disconnected", () => {
                this.isConnected = false;
                logger.warn("MongoDB 连接断开");
            });

            mongoose.connection.on("error", (err) => {
                logger.error(`MongoDB 错误: ${err}`);
            });

            logger.info("MongoDB 连接成功");
        } catch (error) {
            logger.error(`MongoDB 连接失败: ${error}`);
            throw error;
        }
    }

    /**
     * 断开连接
     */
    public async disconnect(): Promise<void> {
        if (this.isConnected) {
            await mongoose.disconnect();
            this.isConnected = false;
            logger.info("MongoDB 连接已关闭");
        }
    }

    /**
     * 检查连接状态
     */
    public isReady(): boolean {
        return this.isConnected && mongoose.connection.readyState === 1;
    }

    /**
     * 获取 Mongoose 实例
     */
    public getMongoose(): typeof mongoose {
        return mongoose;
    }

    /**
     * 获取底层 MongoClient 实例
     * 用于需要直接使用 MongoClient 的场景（如 LangGraph Checkpointer）
     */
    public getClient(): any {
        if (!this.isConnected) {
            throw new Error("MongoDB 未连接，请先调用 initialize()");
        }
        return mongoose.connection.getClient();
    }

    /**
     * 构建连接字符串
     */
    private buildConnectionString(config: any): string {
        const {
            host,
            port,
            database,
            username,
            password,
            authSource,
        } = config;

        if (username && password) {
            return `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=${authSource || "admin"}`;
        }

        return `mongodb://${host}:${port}/${database}`;
    }
}

/**
 * 获取全局 MongoDB 客户端实例
 */
export function getMongoDBClient(): MongoDBClient {
    return MongoDBClient.getInstance();
}

/**
 * 检查数据库是否已连接
 */
export function isDatabaseReady(): boolean {
    return MongoDBClient.getInstance().isReady();
}
