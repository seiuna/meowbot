/**
 * MCP config loader.
 */

import { readFile, writeFile } from "node:fs/promises";
import { MCPConfig } from "./types.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("MCPConfig");

export const DEFAULT_MCP_CONFIG_PATH = "config/mcp-config.json";

/**
 * Load MCP configuration from a JSON file.
 * Returns an empty config if the file does not exist.
 */
export async function loadMCPConfig(configPath?: string): Promise<MCPConfig> {
    const path = configPath || process.env.MCP_CONFIG_PATH || DEFAULT_MCP_CONFIG_PATH;

    try {
        const raw = await readFile(path, "utf-8");
        const parsed = JSON.parse(raw) as MCPConfig;

        if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
            logger.warn(`MCP config file ${path} has no "mcpServers" object`);
            return { mcpServers: {} };
        }

        logger.info(`Loaded MCP config from ${path} with ${Object.keys(parsed.mcpServers).length} server(s)`);
        return parsed;
    } catch (error: any) {
        if (error.code === "ENOENT") {
            logger.info(`No MCP config file found at ${path}, skipping MCP providers`);
            return { mcpServers: {} };
        }
        logger.error(`Failed to load MCP config from ${path}: ${error.message}`);
        throw error;
    }
}

/**
 * Save MCP configuration to the JSON file.
 */
export async function saveMCPConfig(config: MCPConfig, configPath?: string): Promise<void> {
    const path = configPath || process.env.MCP_CONFIG_PATH || DEFAULT_MCP_CONFIG_PATH;
    const json = JSON.stringify(config, null, 2);
    await writeFile(path, json, "utf-8");
    logger.info(`Saved MCP config to ${path} with ${Object.keys(config.mcpServers).length} server(s)`);
}
