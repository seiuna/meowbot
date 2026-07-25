/**
 * MCP configuration types — minimal: only the fields your project actually uses.
 *
 * Config file shape (config/mcp-config.json):
 * {
 *   "mcpServers": {
 *     "server1": {
 *       "name": "My Server",
 *       "description": "Optional description",
 *       "transport": "stdio",
 *       "command": "node",
 *       "args": ["server.js"],
 *       "env": { "API_KEY": "xxx" }
 *     },
 *     "server2": {
 *       "name": "Remote MCP",
 *       "transport": "http",
 *       "url": "https://example.com/mcp",
 *       "headers": { "Authorization": "Bearer xxx" }
 *     }
 *   }
 * }
 */

export interface MCPStdioServerConfig {
    name?: string;
    description?: string;
    transport?: "stdio";
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export interface MCPHttpServerConfig {
    name?: string;
    description?: string;
    transport?: "http" | "sse";
    url: string;
    headers?: Record<string, string>;
}

export type MCPServerConfig = MCPStdioServerConfig | MCPHttpServerConfig;

export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}
