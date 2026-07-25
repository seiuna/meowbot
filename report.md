# Dispatcher 逻辑分析报告

## 1. 当前架构概述

### 消息处理流程

```
QQ Platform -> NapCat -> NapLink -> QQAdapter
  -> handleIncomingMessage() -> MessageEventBuilder
  -> [if starts with "/"] handleCommandMessage() -> gateway.process(msg, "command")
  -> [else] handleMessage() -> debounce/merge -> gateway.process(msg, "message")
  -> MessageGateway.process() -> builds SessionContext -> executePipeline()
  -> LoggerMiddleware (log) -> DispatcherConsumer -> dispatcherRegistry.dispatch(ctx)
  -> CMDdispatcher (for commands) -> CommandRegistry -> Command.execute()
```

### Dispatcher 相关组件

| 文件 | 组件 | 职责 |
|---|---|---|
| `src/dispatcher/index.ts` | `DispatcherRegistry` | 根据 `sessionType` 路由到对应的 dispatcher |
| `src/dispatcher/index.ts` | `dispatcherRegistry` | 全局单例 |
| `src/command/dispatcher.ts` | `CMDdispatcher` | 处理 command 类型的 SessionContext |
| `src/command/dispatcher.ts` | `CommandRegistry` | 存储和管理命令 |
| `src/gateway/message_gateway.ts` | `DispatcherConsumer` | 中间件，调用 `dispatcherRegistry.dispatch(ctx)` |

---

## 2. 问题分析

### 2.1 DispatcherRegistry 功能过于简单

```typescript
// src/dispatcher/index.ts
export class DispatcherRegistry {
    private dispatchers: Map<string, MessageDispatcher> = new Map();

    public registerDispatcher(sessionType: string, dispatcher: MessageDispatcher): void {
        this.dispatchers.set(sessionType, dispatcher);
    }

    public async dispatch(ctx: SessionContext<any>): Promise<void> {
        const dispatcher = this.dispatchers.get(ctx.sessionType);
        if (!dispatcher) {
            ctx.exception(new Error(`No dispatcher registered for session type: ${ctx.sessionType}`));
            return Promise.resolve();
        }
        return dispatcher(ctx);
    }
}
```

**问题**：
- 只是一个简单的 `Map<string, Function>` 查找
- 增加了一层不必要的抽象
- 目前只注册了一个 dispatcher（"command"）

### 2.2 DispatcherConsumer 中间件冗余

```typescript
// src/gateway/message_gateway.ts
export const DispatcherConsumer: Middleware<SessionContext<SessionType>> = async (ctx, _next) => {
    dispatcherRegistry.dispatch(ctx);
};
```

**问题**：
- 只是简单调用 `dispatcherRegistry.dispatch(ctx)`
- 没有增加任何实际价值
- 增加了代码的间接性和复杂度

### 2.3 当前依赖关系

```
message_gateway.ts
    ↓ import
dispatcher/index.ts (DispatcherRegistry)
    ↓ import
command/dispatcher.ts (CMDdispatcher)
```

---

## 3. 重构方案

### 3.1 目标架构

```
MessageEvent -> MessageGateway.process() -> 中间件管道:
  1. LoggerMiddleware (日志)
  2. CommandMiddleware (直接处理 command 类型)
  3. MessageMiddleware (处理普通消息类型 - 待实现)
```

### 3.2 删除 DispatcherRegistry

**删除文件**：
- `src/dispatcher/index.ts`
- `src/dispatcher/` 目录（如果只有这一个文件）

### 3.3 重构 MessageGateway

**修改 `src/gateway/message_gateway.ts`**：

```typescript
import { CMDdispatcher } from "@meowbot/command/dispatcher";

// 替换 DispatcherConsumer
export const CommandMiddleware: Middleware<SessionContext<SessionType>> = async (ctx, next) => {
    if (ctx.sessionType === "command") {
        await CMDdispatcher(ctx as SessionContext<"command">);
        return; // 终端中间件，不调用 next
    }
    await next(); // 非 command 类型，继续管道
};

export const MessageMiddleware: Middleware<SessionContext<SessionType>> = async (ctx, next) => {
    if (ctx.sessionType === "message") {
        // TODO: 处理普通消息
        console.log("Message handler not implemented yet");
        return;
    }
    await next();
};

export async function bootstrapMessageGateway() {
    messageGateway.use(LoggerMiddleware);
    messageGateway.use(CommandMiddleware);
    messageGateway.use(MessageMiddleware);
    
    messageGateway.registerAdapter(new QQAdapter());
    
    await messageGateway.connectAllAdapters(); 
}
```

### 3.4 简化 app.ts

**修改 `src/app.ts`**：

```typescript
import { bootstrapCommandRegistry } from "./command/dispatcher.js";
import { bootstrapDatabase, shutdownDatabase } from "./database/init.js";
// 删除: import { bootstrapDispatcherRegistry } from "./dispatcher/index.js";
import { bootstrapMessageGateway, MessageGateway } from "./gateway/index.js";
import { getLogger } from "./utils/logs.js";

export async function startApp(): Promise<void> {
    try {
        logger.info("Starting application...");
        await bootstrapDatabase();
        await bootstrapMessageGateway();
        await bootstrapCommandRegistry();
        // 删除: await bootstrapDispatcherRegistry();
    } catch (error) {
        throw error;
    }
}
```

---

## 4. 重构步骤

### 步骤 1：修改 message_gateway.ts

1. 移除 `import { dispatcherRegistry } from "@meowbot/dispatcher";`
2. 添加 `import { CMDdispatcher } from "@meowbot/command/dispatcher";`
3. 删除 `DispatcherConsumer` 中间件
4. 添加 `CommandMiddleware` 中间件
5. 添加 `MessageMiddleware` 中间件（占位）
6. 修改 `bootstrapMessageGateway()` 函数

### 步骤 2：修改 app.ts

1. 移除 `import { bootstrapDispatcherRegistry } from "./dispatcher/index.js";`
2. 移除 `await bootstrapDispatcherRegistry();`

### 步骤 3：删除 dispatcher 目录

1. 删除 `src/dispatcher/index.ts`
2. 删除 `src/dispatcher/` 目录

### 步骤 4：验证

1. 运行 TypeScript 编译检查：`npx tsc --noEmit`
2. 测试 command 功能是否正常

---

## 5. 影响分析

### 5.1 优点

| 优点 | 说明 |
|---|---|
| **减少抽象层** | 删除不必要的 DispatcherRegistry 类 |
| **代码更简洁** | 消除间接调用，逻辑更清晰 |
| **符合中间件模式** | 直接在中间件中处理路由，更符合 Koa 风格 |
| **易于扩展** | 添加新 sessionType 只需添加新中间件 |
| **减少文件数量** | 删除整个 dispatcher 目录 |

### 5.2 风险

| 风险 | 缓解措施 |
|---|---|
| **功能回归** | 确保 CMDdispatcher 逻辑不变 |
| **类型安全** | 使用泛型确保 SessionContext 类型正确 |
| **未来扩展** | 如果需要复杂的路由逻辑，可以重新引入 |

### 5.3 代码行数变化

| 文件 | 变化 |
|---|---|
| `src/dispatcher/index.ts` | -48 行（删除） |
| `src/gateway/message_gateway.ts` | +15 行（新中间件） |
| `src/app.ts` | -2 行 |
| **净变化** | **-35 行** |

---

## 6. 结论

**建议执行重构**。

当前的 `DispatcherRegistry` 只是一个简单的 Map 查找，增加了不必要的复杂度。MessageGateway 的中间件管道已经具备路由能力，可以直接在中间件中根据 `sessionType` 分发处理。

重构后：
- 代码更简洁
- 架构更清晰
- 更容易维护和扩展

---

## 附录：相关文件清单

| 文件路径 | 作用 | 重构操作 |
|---|---|---|
| `src/dispatcher/index.ts` | DispatcherRegistry 定义 | **删除** |
| `src/gateway/message_gateway.ts` | MessageGateway + 中间件 | **修改** |
| `src/app.ts` | 应用入口 | **修改** |
| `src/command/dispatcher.ts` | CMDdispatcher + CommandRegistry | 保持不变 |
| `src/command/index.ts` | Command 模块导出 | 保持不变 |
