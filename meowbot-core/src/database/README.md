# MongoDB 数据库操作使用指南

## 概述

MEOWBOT 的 MongoDB 模块提供了完整的 CRUD 操作，包括初始化、连接管理、数据更新、查询和删除。

## 初始化数据库

在应用启动时调用初始化函数：

```typescript
import { initializeDatabase, shutdownDatabase } from "meowbot/database/index.js";

// 应用启动
async function startup() {
    try {
        await initializeDatabase();
        console.log("数据库初始化完成");
    } catch (error) {
        console.error("数据库初始化失败:", error);
        process.exit(1);
    }
}

// 应用关闭
async function shutdown() {
    await shutdownDatabase();
}
```

## 更新操作 (operations.ts)

### 更新用户档案

```typescript
import { 
    updateUserProfile, 
    updateUserWarmth, 
    updateUserTrust,
    addUserTags,
    removeUserTags,
    updateUserSummary
} from "meowbot/database/index.js";

// 全量更新用户档案
await updateUserProfile("user123", {
    tags: ["活跃", "友善"],
    summary: "这是一个测试用户",
    warmth: 50,
    trust: 70
});

// 增加好感度
await updateUserWarmth("user123", 5); // 增加5点好感度

// 增加信任度
await updateUserTrust("user123", 10); // 增加10点信任度

// 添加标签
await addUserTags("user123", ["新手", "推荐"]);

// 移除标签
await removeUserTags("user123", ["新手"]);

// 更新总结
await updateUserSummary("user123", "用户的最新评价");

// 增量更新多个字段（可用于计数器、评分等）
await incrementUserFields("user123", {
    warmth: 5,
    trust: 3
});
```

### 更新会话和消息

```typescript
import { updateSession, updateMessageLog } from "meowbot/database/index.js";

// 更新会话
await updateSession("thread123", {
    status: "active",
    lastMessage: "Hello"
});

// 更新消息记录
await updateMessageLog("msg123", {
    status: "read",
    processedAt: new Date()
});
```

### 批量更新

```typescript
import { updateUserProfileBatch } from "meowbot/database/index.js";

// 批量更新所有标签包含 "VIP" 的用户
await updateUserProfileBatch(
    { tags: "VIP" },
    { trust: 90 }
);
```

## 查询操作 (queries.ts)

### 查询用户档案

```typescript
import {
    getUserProfile,
    getAllUserProfiles,
    getUserProfilesByTag,
    getUserWarmth,
    getUserTrust,
    getUserTags,
    getTopWarmthUsers,
    getTopTrustUsers,
    userExists
} from "meowbot/database/index.js";

// 获取指定用户档案
const profile = await getUserProfile("user123");
console.log(profile);

// 获取用户好感度
const warmth = await getUserWarmth("user123");

// 获取用户信任度
const trust = await getUserTrust("user123");

// 获取用户标签列表
const tags = await getUserTags("user123");

// 获取所有用户档案
const allProfiles = await getAllUserProfiles();

// 按标签查询用户
const vipUsers = await getUserProfilesByTag("VIP");

// 排序查询：好感度最高的10个用户
const topWarmth = await getTopWarmthUsers(10);

// 排序查询：信任度最高的10个用户
const topTrust = await getTopTrustUsers(10);

// 检查用户是否存在
const exists = await userExists("user123");

// 自定义条件查询
import { queryUserProfiles } from "meowbot/database/index.js";
const results = await queryUserProfiles(
    { warmth: { $gte: 50 } }, // warmth >= 50
    10,  // 返回10条
    0    // 跳过0条
);
```

### 查询会话和消息

```typescript
import {
    getSession,
    getSessionsByUserId,
    getMessageLog,
    getMessageLogsByUserId
} from "meowbot/database/index.js";

// 获取指定会话
const session = await getSession("thread123");

// 获取用户的所有会话
const userSessions = await getSessionsByUserId("user123");

// 获取指定消息记录
const message = await getMessageLog("msg123");

// 获取用户的消息记录（最近100条）
const userMessages = await getMessageLogsByUserId("user123", 100);
```

### 统计操作

```typescript
import {
    countUserProfiles,
    countSessions
} from "meowbot/database/index.js";

// 统计用户档案数量
const userCount = await countUserProfiles();

// 统计会话数量
const sessionCount = await countSessions();
```

## 删除操作 (delete.ts)

```typescript
import {
    deleteUserProfile,
    deleteSession,
    deleteMessageLog,
    deleteUserProfilesBatch,
    deleteOldSessions,
    deleteOldMessageLogs,
    clearCollection
} from "meowbot/database/index.js";

// 删除指定用户档案
await deleteUserProfile("user123");

// 删除指定会话
await deleteSession("thread123");

// 删除指定消息
await deleteMessageLog("msg123");

// 批量删除满足条件的用户档案
await deleteUserProfilesBatch({ warmth: { $lt: 0 } });

// 删除30天前的会话
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
await deleteOldSessions(thirtyDaysAgo);

// 删除90天前的消息记录
const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
await deleteOldMessageLogs(ninetyDaysAgo);

// 清空集合 (谨慎使用!)
await clearCollection("sessions");
```

## 完整示例

```typescript
import {
    initializeDatabase,
    updateUserWarmth,
    updateUserTrust,
    getUserProfile,
    getTopWarmthUsers
} from "meowbot/database/index.js";

async function main() {
    // 初始化
    await initializeDatabase();

    // 更新用户
    await updateUserWarmth("alice", 10);
    await updateUserTrust("alice", 5);

    // 查询用户
    const profile = await getUserProfile("alice");
    console.log("用户档案:", profile);

    // 获取排行榜
    const topUsers = await getTopWarmthUsers(5);
    console.log("好感度排行TOP5:", topUsers);
}

main().catch(console.error);
```

## 错误处理

所有函数都会在失败时抛出错误，建议使用 try-catch：

```typescript
try {
    await updateUserWarmth("user123", 5);
} catch (error) {
    console.error("更新失败:", error.message);
}
```

## 日志

所有数据库操作都会记录日志：
- **信息日志**: 操作成功时
- **错误日志**: 操作失败时

可以通过 logger 配置查看详细信息。

## 集合结构

### user_profiles
- userId (唯一)
- tags (数组)
- summary (文本)
- warmth (数字)
- trust (数字)
- createdAt (日期)
- updatedAt (日期)

### sessions
- threadId (唯一)
- userId
- createdAt (带TTL，30分钟后自动删除)
- updatedAt

### message_logs
- messageId (唯一)
- userId
- threadId
- timestamp
- updatedAt

## 配置

MongoDB 配置在 `src/meowbot/config/app-config.ts`：

```typescript
import { mongoDBConfig } from "meowbot/config/index.js";

console.log(mongoDBConfig.host);     // localhost
console.log(mongoDBConfig.port);     // 27017
console.log(mongoDBConfig.database); // meowbot
```

