/**
 * Mongoose Schema 和 Model 定义
 * 定义所有数据库集合的结构
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// ── User Profile ──

export interface IUserWarmthHistory {
    from: number;
    to: number;
    reason: string;
    timestamp: number;
}

export interface IUserProfile extends Document {
    userId: string;
    tags: string[];
    summary?: string;
    warmth: number;
    trust: number;
    warmthHistory: IUserWarmthHistory[];
    /** 用户的 session 列表 */
    sessions: string[];
    /** 当前选中的 session，null 表示使用默认 */
    selectedSession?: string | null;
    /** 用户选择的 agent 名称 */
    agent?: string;
    /** 直接分配的权限规则 */
    permissions: string[];
    /** 用户所属的权限组 */
    permissionGroups: string[];
}

const UserWarmthHistorySchema = new Schema<IUserWarmthHistory>({
    from: { type: Number, required: true },
    to: { type: Number, required: true },
    reason: { type: String, required: true },
    timestamp: { type: Number, required: true },
}, { _id: false });

const UserProfileSchema = new Schema<IUserProfile>({
    userId: { type: String, required: true, unique: true, index: true },
    tags: { type: [String], default: [] },
    summary: { type: String },
    warmth: { type: Number, default: 0 },
    trust: { type: Number, default: 0 },
    warmthHistory: { type: [UserWarmthHistorySchema], default: [] },
    sessions: { type: [String], default: [] },
    selectedSession: { type: String, default: null },
    agent: { type: String, default: null },
    permissions: { type: [String], default: [] },
    permissionGroups: { type: [String], default: [] },
}, {
    timestamps: true,
    collection: "user_profiles",
});

export const UserProfileModel: Model<IUserProfile> = mongoose.model<IUserProfile>("UserProfile", UserProfileSchema);

// ── Permission Group ──

export interface IPermissionGroup extends Document {
    name: string;
    description?: string;
    permissions: string[];
    priority?: number;
}

const PermissionGroupSchema = new Schema<IPermissionGroup>({
    name: { type: String, required: true, unique: true, index: true },
    description: { type: String },
    permissions: { type: [String], default: [] },
    priority: { type: Number, default: 0 },
}, {
    timestamps: true,
    collection: "permission_groups",
});

export const PermissionGroupModel: Model<IPermissionGroup> = mongoose.model<IPermissionGroup>("PermissionGroup", PermissionGroupSchema);

// ── Session ──

export interface ISession extends Document {
    threadId: string;
    userId: string;
    data?: Record<string, any>;
}

const SessionSchema = new Schema<ISession>({
    threadId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    data: { type: Schema.Types.Mixed },
}, {
    timestamps: true,
    collection: "sessions",
});

// TTL index: auto-delete after 24 hours
SessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const SessionModel: Model<ISession> = mongoose.model<ISession>("Session", SessionSchema);

// ── Message Log ──

export interface IMessageLog extends Document {
    messageId: string;
    userId: string;
    threadId: string;
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

const MessageLogSchema = new Schema<IMessageLog>({
    messageId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    threadId: { type: String, required: true, index: true },
    content: { type: String, required: true },
    timestamp: { type: Date, required: true, index: true },
    metadata: { type: Schema.Types.Mixed },
}, {
    timestamps: true,
    collection: "message_logs",
});

export const MessageLogModel: Model<IMessageLog> = mongoose.model<IMessageLog>("MessageLog", MessageLogSchema);

// ── Export All Models ──

export const Models = {
    UserProfile: UserProfileModel,
    PermissionGroup: PermissionGroupModel,
    Session: SessionModel,
    MessageLog: MessageLogModel,
};
