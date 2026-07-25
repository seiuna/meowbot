# AGENTS.md

Compact ramp-up for OpenCode sessions on this repo. All terminology unified to current codebase state.

## Repo shape

- pnpm monorepo: `meowbot-core` (main app) + `meowbot-webui` (admin panel) + `meowbot-images` (image gen UI) + `packages/shared` (shared types/utils).
- Runtime: Node 22, TypeScript ESM, `type: "module"`.
- Entry point: `meowbot-core/src/app.ts` (`pnpm dev` runs `tsx src/app.ts`).
- No root scripts; run commands from inside each package or via `pnpm --filter`.
- `pnpm-workspace.yaml`: packages are `meowbot-core`, `meowbot-images`, `meowbot-webui`, `packages/*`.

## Developer commands

```bash
# Dependencies
pnpm install

# Shared package (build first — consumed from dist/)
pnpm --filter @meowbot/shared build       # tsup -> dist/
pnpm --filter @meowbot/shared dev         # tsup --watch

# Core app
pnpm --filter meowbot dev                 # tsx watch src/app.ts
pnpm --filter meowbot build               # tsc -> dist/
pnpm --filter meowbot start               # node dist/app.js
pnpm --filter meowbot exec tsc --noEmit   # type check
pnpm --filter meowbot test                # vitest (node env)

# Web UI (admin panel — Vue 3 + Naive UI)
pnpm --filter meowbot-webui dev           # vite (port 5173, proxies /api → :35023)
pnpm --filter meowbot-webui build         # vue-tsc -b && vite build

# Image generation UI (Puppeteer-rendered pages)
pnpm --filter meowbot-images dev          # vite
pnpm --filter meowbot-images build        # run-p type-check "build-only {@}" --
pnpm --filter meowbot-images test:unit    # vitest (jsdom env)
pnpm --filter meowbot-images format       # prettier --write src/
pnpm --filter meowbot-images lint         # oxlint + eslint
```

## Module / path quirks

- `meowbot-core` `tsconfig` path alias: `@meowbot/*` -> `meowbot-core/src/*`.
- `meowbot-images` and `meowbot-webui` use `@` -> `src/` (Vite alias).
- ESM: add `.js` extension for new/modified relative imports in `meowbot-core`.
- `@meowbot/shared` consumed from its `dist/` build, not source.

## Shared package (`packages/shared/`)

- Build tool: `tsup` (ESM + `.d.ts`).
- Exports Zod schemas + TypeScript types for config (`config.types.ts`) and card data (`card.types.ts`).
- Also exports `utils/formatters.ts`: `DateFormatters` (toLocaleString zh-CN, toISO, toUnixTimestamp, toRelative) and `TextFormatters`.
- All schemas use Zod v4 (`zod` v4.4.2).

## Testing

- Framework: **Vitest** with globals enabled.
- Test files: `*.test.ts` (not `*.spec.ts`), co-located with source in `meowbot-core/src/`.
- `meowbot-core`: node environment, coverage thresholds 60% lines/functions/statements, 50% branches, 30s timeout.
- `meowbot-images`: jsdom environment, merges with vite config.
- Only 3 test files currently exist in `meowbot-core`: `command.test.ts`, `matcher.test.ts`, `config.test.ts`.

## Runtime dependencies

- **MongoDB**: `MONGO_HOST`, `MONGO_PORT`, `MONGO_DATABASE`, `MONGO_USERNAME`, `MONGO_PASSWORD` (defaults in `src/config/app-config.ts`).
- **QQ adapter**: `config/config.json` -> `qq:naplink-config.url` (default `ws://127.0.0.1:3001`).
- **MCP tools**: `config/mcp-config.json` (override with `MCP_CONFIG_PATH`). Supported transports: `stdio` (stdio), `sse` (SSE), `http` (HTTP). Cleaned on load: `serverKey__` prefix stripped from tool names, `Error Responses:` section trimmed from descriptions. Each server entry can set `"name"` as ToolProvider name.
- **LLM models**: `config/config.json` -> `llm:chat_models` (executor, intent, planner, rag, rewrite, compactor).
- **Image generation**: Puppeteer-based, dev uses `http://localhost:5173`, prod uses `AppServer.baseUrl`.
- **Config dirs**: `config/` is gitignored by `meowbot-core/.gitignore`.

## Startup order

`app.ts` -> `bootstrapDatabase()` -> `BootstrapKeyManager.generate()` (prints one-time registration key) -> `AppServer.start()` -> `bootstrapMessageGateway()` -> `bootstrapCommandRegistry()` -> **register built-in ToolProviders** (Subagent, Workspace, System, ScheduledTools, UserIntervention, Notification) -> register workspace (LocalWorkspace → `../workspace/`) -> `bootstrapMCPProviders()` (loads MCP tools from config) -> `bootstrapAgentRegistry()` -> load plugins -> init plugins.

## Architecture

### Message flow

`QQAdapter` -> `MessageGateway.process()` -> middleware pipeline (`SessionResolverMiddleware` -> `LoggerMiddleware` -> `CommandDispatcherMiddleware` -> `AgentDispatcherMiddleware`) -> `AgentRegistry` -> agent `handleSession()`.

### Agent system (`src/agent/`)

- **`BaseAgent`** (`types.ts`): Abstract base. Constructor takes `(name, description, requiredToolProviders?)`. `requiredToolProviders` is a list of ToolProvider names — empty = all tools, specified = only those providers. Provides `getTools()` which filters `ToolRegistry.getToolsForProviders()`. Also provides `clearThread(threadId)` — waits for running execution to finish then calls `updateState` to wipe conversation.
- **`AgentRegistry`** (`agent_registry.ts`): `registerAgent()`, `getAgent()`, `list()`, `getAll()`, `getDefaultAgentId()`.
- **`DefaultAgent`** (`agents/default_agent.ts`): LangGraph StateGraph (`contentFilter -> executor <-> tools`). `requiredToolProviders: ["Subagent", "Workspace", "System", "ScheduledTools", "UserIntervention", "Notification"]`. Uses `Prompts.build("agent-system")` for system prompt. Logs LLM usage stats and records to `TokenStore`.
- **`CustomAgent`** (`tools/subagent/custom_agent.ts`): Extends `BaseAgent`. LangGraph StateGraph (`executor <-> tools`) with **`MongoDBSaver`** checkpoint (persists to MongoDB). Used by `run_subagent` / `schedule_subagent` tools. `run()` returns `{ output, iterations, toolsUsed, threadId }` and supports `recallThreadId` to resume previous sub-agent conversations.
- **`ScheduledCustomAgent`** (`tools/subagent/custom_agent.ts`): Extends `CustomAgent`. After execution, delivers final output to notification targets via `messageGateway.notify()`.
- **`TestAgent`** (`agents/test_agent.ts`): Echo agent, no LangGraph.
- **`ThreadManager`** (`thread_manager.ts`): `compactThread(graph, threadId)` (LLM summarize + `RemoveMessage` + `updateState`), `clearThread(graph, threadId)` (MongoDB `deleteMany` + `updateState`).
- **`Checkpointer`** (`checkpointer.ts`): `MongoDBSaver` singleton for LangGraph.

### Tool system (`src/tools/`)

- **`defineEnvToolWithThought(config, handler, toolConfig?)`** (`tools.ts`): Creates a `DynamicStructuredTool` with thought-stripping, token estimation, logging, and runtime permission checks. `ToolPermsConfig`: `{ perms?, isEnabled?, required? }`. Logs all tool calls with `[tool:name]` prefix including input/output tokens and full result preview.
- **`wrapToolWithThought(tool, toolConfig?)`**: Wraps an existing tool (e.g. MCP) with the same layer.
- **`ToolRegistry`** (`tool_registry.ts`): `register(provider)`, `getAllTools()`, `getToolsForProviders(names)`, `getProviders()`, `searchTools(query)`, `getToolInfo(name)`.
- **`EnvTool`**: Abstract type carrying `perms`, `isEnabled`, `required` metadata.

**Built-in ToolProviders:**

| Provider | Location | Contents |
|----------|----------|----------|
| `System` | `tools/system/system_tools.ts` | web_search, image_viewer, create_todo_list, mark_step_complete, finish_task |
| `Subagent` | `tools/subagent/index.ts` | search_prompts, search_tool_providers, search_tools, run_subagent |
| `Workspace` | `workspace/workspace_tools.ts` | list_workspaces, list_workspace_files, read_workspace_file, write_workspace_file, search_workspace_file, publish_workspace_file |
| `ScheduledTools` | `tools/scheduled_tools.ts` | list_scheduled_tasks, delete_scheduled_task, schedule_subagent |
| `UserIntervention` | `tools/user/user_tools.ts` | ask_user (HITL — pauses execution and waits for user choice) |
| `Notification` | `tools/user/notification_tools.ts` | list_notify_targets |
| MCP providers | `mcp/provider.ts` | Dynamic from `mcp-config.json`, wrapped with `wrapToolWithThought` |

**Note**: `run_subagent` and `schedule_subagent` have `tool_providers` as **optional** — empty → all non-Subagent tools. Sub-agent tools ALWAYS exclude `Subagent` provider to prevent recursion. System prompt can be `system_prompt` (inline) or `prompt_name` (load from `prompts/` or `skills/` via `search_prompts`). `run_subagent` supports `recall` mode with `thread_id` to continue a previous sub-agent conversation; returns `thread_id` for future recall. `schedule_subagent` requires `user.createtask` permission.

### Command system (`src/command/`)

- **`CommandRegistry`**: `register(name, aliases)`, `getOrCreate(name, aliases)`. Resolves `literal` children before `argChild`.
- **`Command`**: `.desc()`, `.literal()`, `.argument()`, `.action()`, `.require(perm)`, `.scope(adapter)`.
- **Plugins** register commands in `onInit(context)` via `context.commandRegistry`.

### Permission system (`src/permission/`)

- Dot-separated paths with `*`/`**` wildcards, `!` denial prefix. Single `*` matches everything.
- **`PermissionManager`**: Groups CRUD, user permissions/groups management.
- **`PermissionService`**: `check(userId, resource)`, `isAllowed(userId, resource)`.
- **`BootstrapKeyManager`** (`bootstrap_key.ts`): One-time 8-char key printed at startup. `/perm register <key>` grants `*` (all permissions).
- Commands: `/perm user`, `/perm group`, `/perm register`, `/perm user add <perm>`.

### Plugin system (`src/plugin/`)

- Plugins auto-loaded from `plugins/` subdirectories (`index.ts`/`index.js`).
- `SystemPlugin`: `/system session`, `/system agent`, `/system thread`, `/system template`, `/system info`.
- `NotifyPlugin`: `/notify create|list|delete` (requires `notify.public` permission for create).

### Notification system

- `/notify create <name>` — saves current session as a notification target (publicId + userId + adapterName).
- `/notify list` — lists all targets for current public context.
- `list_notify_targets` — LLM tool to query targets.
- `schedule_subagent` requires at least one `notify_target_ids`.
- At schedule fire time, `ScheduledCustomAgent` calls `messageGateway.notify()` → emits `notify` event on adapter.
- `QQAdapter` listens to `notify` event and sends via `sendGroupMessage`/`sendPrivateMessage`.

### Template system (`src/template/`)

Three directories at project root organize all prompt/skill/template content:

| Directory | Purpose | `asSubAgent` | Example |
|-----------|---------|-------------|---------|
| `prompts/` | Agent & sub-agent system prompts | Yes (toggle) | `agent-system`, `content-filter`, `agent-notion`, `email`, `slide-generator`, `context-compact` |
| `skills/` | Tool-providing skills (dynamic tool loading) | No | (plugin-loaded skills) |
| `templates/` | Message/env formatting templates | No | `qq_message`, `bilibili_message`, `env` |

Each folder contains:
- `skill.md` — content with YAML frontmatter: `name`, `description`, `required-providers`, `as-sub-agent`
- `few-shot.json` — optional few-shot pairs: `[{"human":"...","ai":"..."}]`

- **`Skill` class** (`skill.ts`): `skill.prompt(data?)` → rendered string; `skill.fewshot()` → `BaseMessage[]`; `skill.tools()` → tools from `required-providers`. Meta includes `category` field (`"prompt" | "skill" | "template"`).
- **`SkillRegistry`** (`skill-registry.ts`): unified lookup across all three directories. `get(name)`, `list()`, `listPrompts()`, `listSkills()`, `listTemplates()`, `build(name, data)`, `fewshot(name)`, `getMeta(name)`.
- **`Prompts`** (backward-compat): delegates to `SkillRegistry`. `build()`, `list()`, `get()`, `getMeta()`, `reload()`.
- **Plugin skills**: each plugin can have a `skills/` folder (categorized as `"skill"`), auto-loaded by `SkillRegistry`.
- `${var.path}` interpolation via `engine.ts`.
- **Workspace registration**: only `prompts/` with `as-sub-agent: true` get read-only workspaces (`skill-<name>`), browsable via workspace tools.
- **`search_prompts`** tool: only returns `prompts/` entries with `asSubAgent: true`.
- **`run_subagent`**: now takes `prompt_name` (not `skill_name`) from `search_prompts` results.

### Image generation (`src/image_generation/`)

- Puppeteer-based HTML-to-PNG pipeline.
- Source types: `fromUrl()`, `fromOfficialUrl(pagePath)`, `fromTemplate(name)`.
- Templates in `data/art-template/` (todo-card.html, schedule-card.html). Design follows `design.md` dark theme.
- `create_todo_list` / `mark_step_complete` / `schedule_subagent` generate visual cards via this pipeline.

### Token tracking (`src/llm/`)

- **`MonitoredCallbackHandler`**: LangChain callback injected into every model via `provider_registry.ts`. Records input/output tokens to `TokenStore`.
- **`TokenStore`**: MongoDB `token_usage` collection. `getStats()` returns aggregate + per-model breakdown.
- **`/system info`**: Command that prints token usage stats with per-model breakdown.

### MCP system (`src/mcp/`)

- `config/mcp-config.json` -> `loadMCPConfig()` -> `MCPToolProvider` -> `wrapToolWithThought()`.
- Config supports stdio (command+args), SSE/HTTP (url+headers).
- Tool names cleaned: `serverKey__` prefix stripped, `Error Responses:` section removed from descriptions.

### Web UIs

**`meowbot-webui/`** (admin panel):
- Vue 3 + Naive UI + Vite, Tailwind CSS 3 with custom brand palette.
- `pnpm --filter meowbot-webui dev` → `localhost:5173`, proxied to backend `:35023`.
- Pages: Dashboard, Agents, Tools (with NSwitch toggle), Workspace (NTree + editor), Prompts, Config (JSON editor), Commands (card grid).
- PWA support: manifest.json, service worker, standalone mode, bottom nav on mobile, responsive layout.
- No Pinia stores; state is local `ref()` in components.
- Backend API at `meowbot-core/src/server/endpoint/api/api.controller.ts` serves all data.
- Routing: lazy-loaded page components defined inline in `main.ts`.

**`meowbot-images/`** (Puppeteer-rendered image gen pages):
- Vue 3 + Pinia + Vite 8, Tailwind CSS 4 (via `@tailwindcss/vite` plugin).
- Pages designed to be loaded headlessly by Puppeteer in `meowbot-core`.
- Routes: `/generation/card`, `/generation/slot`, `/generation/github-card`.
- Key composable: `useGenerationData<T>()` — loads data from `window.__INITIAL_DATA__` (injected by Puppeteer), `window.__RENDER_PAGE__` (re-render without reload), or fallback `fetch()`.
- `useRenderSignal()` — signals `window.__VUE_RENDERED__` after double rAF + font loading, so Puppeteer captures fully painted frames.
- Has ESLint, oxlint, Prettier configured (better tooling than meowbot-core/webui).
- EditorConfig: 2-space indent, LF, max line 100.

### Key commands reference

| Command | Function |
|---------|----------|
| `/perm register <key>` | Claim `*` admin with bootstrap key |
| `/perm user <userId> add <perm>` | Append permission rule or join group (auto-detects) |
| `/perm user/group <...>` | Manage permissions and groups |
| `/system agent list` | List all agents |
| `/system agent info [name]` | Show agent details + tools |
| `/system thread compact` | LLM-summarize conversation history |
| `/system thread clear` | Wipe conversation history |
| `/system template list` | List prompt templates |
| `/system info` | Token usage stats with per-model breakdown |
| `/notify create <name>` | Create notification target (requires `notify.public`) |
| `/notify list` | List notification targets |
| `/notify delete <id>` | Delete notification target |

### Common pitfalls

- **Never hardcode credentials or tokens.** Use environment variables or `config/` files (which are gitignored). The code review found hardcoded proxy URLs (`127.0.0.1:7891`) and QQ tokens in source — these have been fixed, don't reintroduce them.
- **Singleton patterns must be consistent.** `meowbot-core` uses several singletons (MongoDBSaver, TokenStore, etc.). Follow the existing pattern: use module-level `let instance: T | null = null` with a `getXxx()` factory, not class-static `getInstance()`.
- **ESM `.js` extensions are required** in `meowbot-core` for relative imports. TypeScript won't catch missing `.js` at compile time — it's a runtime ESM requirement.
- **Config files are gitignored.** `meowbot-core/config/` is in `.gitignore`. Never commit configs with real credentials. The `config/README.md` documents expected structure.
- **`design.md` at root is unrelated to MeowBot** — it's a Saniti marketing design doc that was copied in. Do not reference it for MeowBot styling decisions.
- **`@meowbot/shared` must be built first.** The core app imports from its `dist/`. Run `pnpm --filter @meowbot/shared build` before working on core if you've changed shared types.
- **Test files use `*.test.ts`**, not `*.spec.ts`. Co-locate tests with source files.

### Tooling gaps

- `meowbot-core` and `meowbot-webui`: No ESLint, Prettier, or pre-commit config.
- `meowbot-images`: Has ESLint + oxlint + Prettier — use as reference if adding linting to other packages.
- No CI workflows.

## Other documentation

| File | Content |
|------|---------|
| `agent-design.md` | Agent dispatch architecture proposal (AgentRegistry, middleware pipeline design) |
| `code-review-report.md` | July 2026 code review: 43 issues found, 31 fixed. Covers singleton patterns, logging, concurrency |
| `error-report.md` | TypeScript error report (June 2026). Historical — most errors now resolved |
| `report.md` | Dispatcher logic analysis and improvement proposals |
| `config/README.md` | Expected structure for `config/` directory |
