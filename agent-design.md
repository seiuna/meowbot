# Agent 分发设计方案

## 1. 当前状态分析

### 已有的基础设施

```typescript
// SessionContext 中的路由字段
interface SessionContext {
    route: {
        agentId: "default-agent" | string;  // Agent 标识
        ttl: number;                        // 防止无限转发
        path: string[];                     // 转发路径追踪
    }
}

// Agent 抽象基类
abstract class BaseAgent {
    abstract handleSession(session: SessionContext): Promise<void>;
}
```

### 缺失的部分

| 组件 | 状态 | 说明 |
|---|---|---|
| AgentRegistry | ❌ 不存在 | 需要创建，管理 Agent 实例 |
| Agent 分发逻辑 | ❌ 不存在 | 需要创建，根据 agentId 路由 |
| 具体 Agent 实现 | ❌ 不存在 | 需要创建继承 BaseAgent 的类 |

---

## 2. 架构设计

### 2.1 整体架构

```
MessageEvent -> MessageGateway -> 中间件管道:
  1. LoggerMiddleware        (日志)
  2. CommandMiddleware        (处理 command 类型)
  3. AgentDispatcherMiddleware (路由到 Agent)
      ↓
  AgentRegistry.getAgent(ctx.route.agentId)
      ↓
  BaseAgent.handleSession(ctx)
```

### 2.2 组件关系图

```
┌─────────────────────────────────────────────────────────────┐
│                      MessageGateway                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Logger     │→ │   Command   │→ │  AgentDispatcher    │ │
│  │  Middleware   │  │  Middleware  │  │    Middleware       │ │
│  └─────────────┘  └─────────────┘  └──────────┬──────────┘ │
└───────────────────────────────────────────────┼─────────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │    AgentRegistry      │
                                    │  Map<string, Agent>   │
                                    └───────────┬───────────┘
                                                │
                            ┌───────────────────┼───────────────────┐
                            ▼                   ▼                   ▼
                    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
                    │ DefaultAgent │    │  QA Agent    │    │  Game Agent  │
                    │  (fallback)  │    │  (知识问答)   │    │   (游戏)     │
                    └──────────────┘    └──────────────┘    └──────────────┘
```

---

## 3. 详细设计

### 3.1 AgentRegistry（新增）

**文件位置**: `src/agent/agent_registry.ts`

```typescript
import { BaseAgent } from "./types";
import { getLogger } from "@meowbot/utils/logs";

const logger = getLogger("AgentRegistry");

export class AgentRegistry {
    private agents: Map<string, BaseAgent> = new Map();
    private defaultAgentId: string = "default-agent";

    /**
     * 注册 Agent
     * @param agentId Agent 唯一标识
     * @param agent Agent 实例
     */
    public registerAgent(agentId: string, agent: BaseAgent): void {
        if (this.agents.has(agentId)) {
            logger.warn(`Agent ${agentId} already registered, overwriting`);
        }
        this.agents.set(agentId, agent);
        logger.info(`Registered agent: ${agentId}`);
    }

    /**
     * 获取 Agent
     * @param agentId Agent 标识
     * @returns Agent 实例，如果不存在则返回默认 Agent
     */
    public getAgent(agentId: string): BaseAgent | undefined {
        return this.agents.get(agentId) ?? this.agents.get(this.defaultAgentId);
    }

    /**
     * 设置默认 Agent
     * @param agentId Agent 标识
     */
    public setDefaultAgent(agentId: string): void {
        if (!this.agents.has(agentId)) {
            throw new Error(`Agent ${agentId} not found`);
        }
        this.defaultAgentId = agentId;
    }

    /**
     * 检查 Agent 是否存在
     * @param agentId Agent 标识
     */
    public hasAgent(agentId: string): boolean {
        return this.agents.has(agentId);
    }
}

export const agentRegistry = new AgentRegistry();
```

### 3.2 AgentDispatcherMiddleware（新增）

**文件位置**: `src/agent/agent_middleware.ts`

```typescript
import { Middleware, SessionContext, SessionType } from "@meowbot/gateway";
import { agentRegistry } from "./agent_registry";
import { getLogger } from "@meowbot/utils/logs";

const logger = getLogger("AgentDispatcher");

/**
 * Agent 分发中间件
 * 根据 ctx.route.agentId 查找并调用对应的 Agent
 */
export const AgentDispatcherMiddleware: Middleware<SessionContext<SessionType>> = async (ctx, next) => {
    const agentId = ctx.route.agentId;
    const agent = agentRegistry.getAgent(agentId);

    if (!agent) {
        logger.error(`No agent found for agentId: ${agentId}`);
        ctx.exception(new Error(`No agent registered for id: ${agentId}`));
        return;
    }

    // 检查 TTL 防止无限转发
    if (ctx.route.ttl <= 0) {
        logger.error(`TTL exceeded for message, routing path: ${ctx.route.path.join(" -> ")}`);
        ctx.exception(new Error("Message routing TTL exceeded"));
        return;
    }

    try {
        await agent.handleSession(ctx);
    } catch (error) {
        logger.error(`Agent ${agentId} error:`, error);
        ctx.exception(error as Error);
    }

    // 终端中间件，不调用 next
};
```

### 3.3 DefaultAgent 实现（新增）

**文件位置**: `src/agent/agents/default_agent.ts`

```typescript
import { BaseAgent } from "../types";
import { SessionContext } from "@meowbot/gateway";
import { getLogger } from "@meowbot/utils/logs";

const logger = getLogger("DefaultAgent");

/**
 * 默认 Agent
 * 处理普通消息的基础 Agent
 */
export class DefaultAgent extends BaseAgent {
    async handleSession(session: SessionContext): Promise<void> {
        logger.info(`DefaultAgent handling session: ${session.sessionId}`);
        
        // TODO: 实现实际的消息处理逻辑
        // 例如：
        // 1. 调用 LLM 生成回复
        // 2. 查询数据库获取上下文
        // 3. 使用工具执行操作
        
        session.message("DefaultAgent: 消息已收到，处理功能尚未实现。");
    }
}
```

### 3.4 Bootstrap 函数

**修改文件**: `src/agent/agent_registry.ts` 或新建 `src/agent/bootstrap.ts`

```typescript
import { agentRegistry } from "./agent_registry";
import { DefaultAgent } from "./agents/default_agent";

export async function bootstrapAgentRegistry(): Promise<void> {
    // 注册默认 Agent
    agentRegistry.registerAgent("default-agent", new DefaultAgent());
    
    // 可以在这里注册更多 Agent
    // agentRegistry.registerAgent("qa-agent", new QAAgent());
    // agentRegistry.registerAgent("game-agent", new GameAgent());
}
```

---

## 4. 集成方案

### 4.1 修改 MessageGateway

**文件**: `src/gateway/message_gateway.ts`

```typescript
import { AgentDispatcherMiddleware } from "@meowbot/agent/agent_middleware";

export async function bootstrapMessageGateway() {
    messageGateway.use(LoggerMiddleware);
    messageGateway.use(CommandMiddleware);       // 处理 command
    messageGateway.use(AgentDispatcherMiddleware); // 路由到 Agent
    
    messageGateway.registerAdapter(new QQAdapter());
    await messageGateway.connectAllAdapters(); 
}
```

### 4.2 修改 app.ts

**文件**: `src/app.ts`

```typescript
import { bootstrapAgentRegistry } from "./agent/bootstrap";

export async function startApp(): Promise<void> {
    try {
        logger.info("Starting application...");
        await bootstrapDatabase();
        await bootstrapMessageGateway();
        await bootstrapCommandRegistry();
        await bootstrapAgentRegistry();  // 新增
    } catch (error) {
        throw error;
    }
}
```

### 4.3 最终中间件管道

```typescript
// 中间件执行顺序
LoggerMiddleware          // 1. 记录日志
    ↓ next
CommandMiddleware         // 2. 如果是 command，处理后返回
    ↓ next (非 command)
AgentDispatcherMiddleware // 3. 路由到对应的 Agent
```

---

## 5. Agent 间消息转发

### 5.1 转发机制

利用已有的 `route.ttl` 和 `route.path` 实现 Agent 间转发：

```typescript
export class RouterAgent extends BaseAgent {
    async handleSession(session: SessionContext): Promise<void> {
        // 判断需要转发到哪个 Agent
        const targetAgentId = this.routeToAgent(session);
        
        // 减少 TTL，记录路径
        session.route.ttl -= 1;
        session.route.path.push(session.route.agentId);
        session.route.agentId = targetAgentId;
        
        // 重新触发分发
        const agent = agentRegistry.getAgent(targetAgentId);
        await agent.handleSession(session);
    }
    
    private routeToAgent(session: SessionContext): string {
        // 根据业务逻辑决定目标 Agent
        if (session.event.message.includes("游戏")) {
            return "game-agent";
        }
        return "default-agent";
    }
}
```

### 5.2 转发流程图

```
用户消息 -> DefaultAgent
               │
               ├─ 判断需要专业处理
               │
               ▼
         RouterAgent (ttl=4, path=["default-agent"])
               │
               ├─ 路由到 QA Agent
               │
               ▼
           QAAgent (ttl=3, path=["default-agent", "router-agent"])
               │
               └─ 处理完成，返回结果
```

---

## 6. 文件结构

```
src/agent/
├── types.ts                 # BaseAgent 抽象类 (已有)
├── checkpointer.ts          # LangGraph checkpointer (已有)
├── agent_registry.ts        # AgentRegistry 类 (新增)
├── agent_middleware.ts      # AgentDispatcherMiddleware (新增)
├── bootstrap.ts             # bootstrapAgentRegistry (新增)
└── agents/
    ├── default_agent.ts     # DefaultAgent (新增)
    ├── qa_agent.ts          # QAAgent (示例，可选)
    └── game_agent.ts        # GameAgent (示例，可选)
```

---

## 7. 消息流程总结

### 7.1 完整流程

```
QQ Platform
    ↓
NapCat -> NapLink
    ↓
QQAdapter.handleIncomingMessage()
    ↓
MessageGateway.process(message, sessionType)
    ↓
构建 SessionContext {
    sessionId: "Session_xxx",
    traceId: "uuid",
    sessionType: "message",
    event: MessageEvent,
    route: { agentId: "default-agent", ttl: 5, path: [] }
}
    ↓
执行中间件管道:
    1. LoggerMiddleware    → 记录日志，调用 next
    2. CommandMiddleware   → 非 command，调用 next
    3. AgentDispatcherMiddleware → 查找 Agent，调用 handleSession
    ↓
AgentRegistry.getAgent("default-agent")
    ↓
DefaultAgent.handleSession(ctx)
    ↓
ctx.message("回复内容")
    ↓
QQAdapter.emit("message", ...)
    ↓
发送到 QQ 用户
```

### 7.2 Command 流程

```
用户发送: /help
    ↓
QQAdapter 识别为 command
    ↓
gateway.process(message, "command")
    ↓
SessionContext.sessionType = "command"
    ↓
CommandMiddleware 拦截
    ↓
CMDdispatcher(ctx) → CommandRegistry → Command.execute()
    ↓
不经过 AgentDispatcherMiddleware
```

---

## 8. 优势与特点

| 特点 | 说明 |
|---|---|
| **解耦** | Agent 注册与分发逻辑分离 |
| **可扩展** | 只需注册新 Agent 即可扩展功能 |
| **复用 SessionContext** | 利用已有的 route 字段，无需新增数据结构 |
| **支持转发** | TTL + path 机制支持 Agent 间消息传递 |
| **中间件模式** | 符合现有架构风格 |
| **类型安全** | 泛型 SessionContext 保证类型正确 |

---

## 9. 待讨论问题

1. **Agent 是否需要生命周期管理？**
   - connect / disconnect 方法
   - 资源清理

2. **Agent 是否需要配置？**
   - 每个 Agent 可能有不同的配置（如 LLM 模型、温度等）

3. **消息是否需要持久化？**
   - 在哪个环节存储到 MongoDB

4. **是否需要支持 Agent 链式调用？**
   - 一个 Agent 处理后传递给下一个 Agent

5. **错误处理策略？**
   - Agent 处理失败时是否回退到默认 Agent
