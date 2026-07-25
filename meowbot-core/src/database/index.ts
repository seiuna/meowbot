/**
 * 数据库模块导出
 * 提供 MongoDB 连接管理 (Mongoose) 和初始化功能
 */

// ── 连接管理 ──
export { MongoDBClient, getMongoDBClient, isDatabaseReady } from "./mongodb.js";
export { initializeCollections } from "./collections.js";
export { bootstrapDatabase as initializeDatabase, shutdownDatabase } from "./init.js";

// ── Models ──
export {
    UserProfileModel,
    PermissionGroupModel,
    SessionModel,
    MessageLogModel,
    Models,
} from "./models.js";

export type {
    IUserProfile,
    IUserWarmthHistory,
    IPermissionGroup,
    ISession,
    IMessageLog,
} from "./models.js";

// ── 查询操作 ──
export {
    getUserWarmth,
    getUserTrust,
    getUserTags,
    getSession,
    getSessionsByUserId,
    getMessageLog,
    getMessageLogsByUserId,
    countUserProfiles,
    countSessions,
    userExists,
} from "./queries.js";

// ── 更新操作 ──
export {
    updateUserWarmth,
    updateUserTrust,
    addUserTags,
    removeUserTags,
    updateUserSummary,
    updateSession,
    updateMessageLog,
    updateUserProfileBatch,
    incrementUserFields,
} from "./operations.js";

// ── 删除操作 ──
export {
    deleteUserProfile,
    deleteSession,
    deleteMessageLog,
    deleteUserProfilesBatch,
    deleteOldSessions,
    deleteOldMessageLogs,
    clearCollection,
} from "./delete.js";
