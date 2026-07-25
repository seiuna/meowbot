/**
 * MCP module entry point.
 */

export { MCPToolProvider } from "./provider.js";
export { loadMCPConfig, saveMCPConfig, DEFAULT_MCP_CONFIG_PATH } from "./config.js";
export type { MCPConfig, MCPServerConfig, MCPHttpServerConfig } from "./types.js";

import { ToolRegistry } from "../tools/tool_registry.js";
import { loadMCPConfig } from "./config.js";
import { MCPToolProvider } from "./provider.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("MCP");

/**
 * Bootstrap MCP tool providers from config and register them into the ToolRegistry.
 * All providers are initialized concurrently.
 */
export async function bootstrapMCPProviders(toolRegistry: ToolRegistry): Promise<void> {
    const config = await loadMCPConfig();

    const servers = Object.entries(config.mcpServers);
    if (servers.length === 0) {
        logger.info("No MCP servers configured");
        return;
    }

    logger.info(`Initializing ${servers.length} MCP provider(s) concurrently...`);

    const results = await Promise.allSettled(
        servers.map(async ([serverKey, serverConfig]) => {
            const provider = new MCPToolProvider(serverKey, serverConfig);
            await provider.initialize();
            toolRegistry.register(provider);
            return serverKey;
        })
    );

    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected");

    for (const r of failed) {
        if (r.status === "rejected") {
            logger.error(`MCP provider init failed: ${r.reason}`);
        }
    }

    logger.info(`MCP bootstrap complete: ${succeeded} succeeded, ${failed.length} failed`);
}
