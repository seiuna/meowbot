/**
 * Application configuration
 * Centralizes all configuration values from environment variables
 */

/**
 * MongoDB configuration interface
 */
export interface MongoDBConfig {
    host: string;
    port: number;
    database: string;
    username?: string;
    password?: string;
    authSource?: string;
}

/**
 * MongoDB configuration
 * Reads from environment variables with fallback defaults
 */
export const mongoDBConfig: MongoDBConfig = {
    host: process.env.MONGO_HOST || "localhost",
    port: parseInt(process.env.MONGO_PORT || "27017", 10),
    database: process.env.MONGO_DATABASE || "meowbot",
    username: process.env.MONGO_USERNAME,
    password: process.env.MONGO_PASSWORD,
    authSource: process.env.MONGO_AUTH_SOURCE || "admin",
};

/**
 * Application-wide configuration
 */
export const appConfig = {
    /** Environment mode */
    nodeEnv: process.env.NODE_ENV || "development",

    /** Log level */
    logLevel: process.env.LOG_LEVEL || "info",

    /** MongoDB configuration */
    mongodb: mongoDBConfig,
};
