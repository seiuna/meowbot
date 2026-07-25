# Configuration Directory

This directory (`config/`) is the **project root** configuration.

- `config.json` — project-level settings (if any)

## Core application config

The main application configuration lives under `meowbot-core/config/`:

- `meowbot-core/config/config.json` — LLM models, QQ adapter, Tavily, tools config
- `meowbot-core/config/mcp-config.json` — MCP server definitions
- `meowbot-core/config/user-defaults.json` — Default user settings

The `meowbot-core/config/config.json` is the **primary config file** used by `FileConfigManager` at runtime (default path: `meowbot-core/config/config.json`).
