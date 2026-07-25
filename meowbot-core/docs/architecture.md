# MeowBot Core Architecture

## Startup Flow
```mermaid
flowchart TD
    A[bootstrapDatabase] --> B[BootstrapKeyManager.generate]
    B --> C[AppServer.start :35023]
    C --> D[bootstrapMessageGateway]
    D --> E[register ToolProviders]
    E --> E1[Subagent]
    E --> E2[Workspace]
    E --> E3[System]
    E --> E4[ScheduledTools]
    E --> E5[UserIntervention]
    E --> E6[Notification]
    E1 & E2 & E3 & E4 & E5 & E6 --> F[register workspace]
    F --> G[bootstrapMCPProviders]
    G --> H[bootstrapAgentRegistry]
    H --> I[load plugins → init plugins]
```

## Message Flow
```mermaid
flowchart LR
    QQ[QQAdapter] --> GW[MessageGateway.process]
    BL[BilibiliAdapter] --> GW
    GW --> MW[Middleware Pipeline]
    MW --> M1[SessionResolver]
    M1 --> M2[Logger]
    M2 --> M3[CommandDispatcher]
    M3 --> M4[AgentDispatcher]
    M4 --> AR[AgentRegistry.get]
    AR --> DA[DefaultAgent.handleSession]
    DA --> LG[LangGraph StateGraph]
```

## Agent System
```mermaid
flowchart TD
    BA[BaseAgent abstract] --> DA[DefaultAgent]
    BA --> CA[CustomAgent]
    BA --> TA[TestAgent]
    
    DA --> GRAPH["StateGraph
    contentFilter → executor ↔ tools"]
    GRAPH --> CK[MongoDBSaver checkpointer]
    DA --> TM[ThreadManager]
    TM --> COMPACT[compactThread: LLM summarize]
    TM --> CLEAR[clearThread: delete + wipe]
    
    CA --> SCA[ScheduledCustomAgent]
    SCA --> NOTIFY[messageGateway.notify]
    CA --> SUB["run_subagent tool
    isolated tools + workspace"]
```

## Tool System
```mermaid
flowchart TD
    TR[ToolRegistry singleton] --> DEF[defineEnvToolWithThought]
    TR --> WRAP[wrapToolWithThought]
    
    DEF --> TP1[SubagentToolProvider]
    DEF --> TP2[WorkspaceToolProvider]
    DEF --> TP3[SystemToolProvider]
    DEF --> TP4[ScheduledToolProvider]
    DEF --> TP5[UserInterventionToolProvider]
    DEF --> TP6[NotificationToolProvider]
    
    TP1 --> T1["search_prompts / search_tools
    run_subagent / search_tool_providers"]
    TP2 --> T2["list / read / write
    search / publish workspace"]
    TP3 --> T3["web_search / image_viewer
    create_todo_list / mark_step_complete
    finish_task / decorate_reply"]
    TP4 --> T4["list_scheduled_tasks
    delete_scheduled_task
    schedule_subagent"]
    TP5 --> T5[ask_user HITL]
    TP6 --> T6[list_notify_targets]
    
    WRAP --> MCP[MCPToolProvider]
    MCP --> MCPCFG[mcp-config.json]
    MCPCFG --> STDIO["stdio: command + args + env"]
    MCPCFG --> HTTP["http/sse: url + headers"]
```

## Workspace System
```mermaid
flowchart TD
    WM[WorkspaceManager singleton] --> LW[LocalWorkspace]
    WM --> RW[ReadOnlyWorkspace]
    
    LW --> FS["node:fs
    safePath traversal guard
    30s TTL listFiles cache"]
    
    LW --> TOOLS["6 tools:
    list_workspaces
    list_workspace_files
    read_workspace_file
    write_workspace_file
    search_workspace_file
    publish_workspace_file"]
    
    TOOLS --> FID["each returns fileid:
    ws/{workspaceId}/{path}"]
    
    RW --> SKILL["skill-* workspaces
    prompts with as-sub-agent: true"]
```

## Template / Prompt System
```mermaid
flowchart TD
    SR[SkillRegistry] --> P[prompts/]
    SR --> S[skills/]
    SR --> T[templates/]
    
    P --> PA["Agent prompts
    asSubAgent toggle
    → search_prompts filter"]
    
    S --> ST["Tool-providing skills
    required-providers
    → dynamic tool loading"]
    
    T --> TP["Message templates
    qq_message / bilibili_message
    env → ${variable} interpolation"]
    
    SK[Skill class] --> PROMPT["prompt(data?) → renderTemplate"]
    SK --> FEWSHOT["fewshot() → HumanMsg/AIMsg"]
    SK --> TOOLS2["tools() → getToolsForProviders"]
    
    PB[Prompts backward-compat] --> SR
```

## Permission System
```mermaid
flowchart LR
    PM[PermissionManager] --> PS[PermissionService]
    PS --> CHECK["check(userId, resource)
    */** wildcard + !deny"]
    BK[BootstrapKeyManager] --> REG["/perm register {key}
    → grants * all permissions"]
    
    CMD1["/perm user {id} add {perm}"] --> PM
    CMD2["/perm group ..."] --> PM
```

## Data Flow Summary
```mermaid
flowchart LR
    USER((User)) -->|QQ/Bilibili| ADAPTER[Adapter]
    ADAPTER -->|MessageEvent| GW[MessageGateway]
    GW -->|middleware pipeline| AGENT[AgentRegistry]
    AGENT -->|handleSession| DA[DefaultAgent]
    
    DA -->|LangGraph| LLM[LLM executor]
    LLM -->|tool_calls| TOOLS[ToolNode]
    TOOLS -->|run_subagent| SUB[CustomAgent]
    SUB -->|MongoDBSaver| MONGO[(MongoDB)]
    
    DA -->|session.message| ADAPTER
    ADAPTER -->|send| USER

    DA -.->|write data| WS[(Workspace)]
    SUB -.->|read/write| WS
```

## Server / API
```mermaid
flowchart TD
    APP[AppServer NestJS+Express :35023] --> API["/api/*
    stats agents tools tokens commands
    config prompts skills
    workspace/tree file download"]
    
    APP --> WSAPI["/workspace/*
    POST /workspace → list all
    POST /workspace/:ws → list dir
    POST /workspace/:ws/* → read/write file"]
    
    APP --> SERVE["/:ws/file?path=
    serve with MIME + cache"]
```

## Workspace Data Exchange Pattern
```mermaid
sequenceDiagram
    participant MA as Main Agent
    participant WS as Workspace
    participant SA as Sub-Agent
    
    MA->>WS: write_workspace_file("meowbot", "data/task.json", content)
    MA->>SA: run_subagent(prompt_name, "Read ws/meowbot/data/task.json")
    SA->>WS: read_workspace_file("meowbot", "data/task.json")
    SA->>SA: ... do work with tools ...
    SA->>WS: write_workspace_file("meowbot", "data/result.json", result)
    SA-->>MA: return { output, iterations, toolsUsed }
    MA->>WS: read_workspace_file("meowbot", "data/result.json")
    MA->>MA: present to user ✨
```
