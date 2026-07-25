/**
 * MCP Tool Provider
 *
 * Wraps a single MCP server (via @langchain/mcp-adapters) as an IToolProvider.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { IToolProvider } from "../tools/tool_registry.js";
import { wrapToolWithThought } from "../tools/tools.js";
import { MCPServerConfig } from "./types.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("MCPToolProvider");

/** Clean raw MCP tool name: strip server-key prefix like "notion__" */
function cleanToolName(name: string, serverKey: string): string {
    const prefix = serverKey + "__";
    if (name.startsWith(prefix)) {
        return name.slice(prefix.length);
    }
    return name;
}

/** Clean raw MCP tool description: remove "Error Responses:" and trailing API docs */
function cleanToolDescription(desc: string): string {
    const idx = desc.indexOf("Error Responses:");
    if (idx !== -1) {
        return desc.slice(0, idx).trim();
    }
    return desc;
}

export class MCPToolProvider implements IToolProvider {
    private client: MultiServerMCPClient | null = null;
    private tools: DynamicStructuredTool[] = [];
    private providerName: string;
    private providerDescription: string;
    private serverKey: string;
    private serverConfig: MCPServerConfig;

    constructor(serverKey: string, serverConfig: MCPServerConfig) {
        this.serverKey = serverKey;
        this.providerName = serverConfig.name || serverKey;
        this.providerDescription = serverConfig.description || `MCP server: ${serverKey}`;
        this.serverConfig = serverConfig;
    }

    /** Connect to the MCP server and load available tools. */
    public async initialize(): Promise<void> {
        logger.info(`Initializing MCP provider "${this.providerName}" for server "${this.serverKey}"`);

        this.client = new MultiServerMCPClient({
            mcpServers: { [this.serverKey]: this.serverConfig },
            prefixToolNameWithServerName: true,
            useStandardContentBlocks: true,
            onConnectionError: "ignore",
        });

        const rawTools = await this.client.getTools();
        this.tools = rawTools.map(t => {
            const cleanedName = cleanToolName(t.name, this.serverKey);
            const cleanedDesc = cleanToolDescription(t.description);
            (t as any).name = cleanedName;
            (t as any).description = cleanedDesc;
            return wrapToolWithThought(t, {
                isEnabled: true,
                required: false,
                perms: [],
            });
        });
        logger.info(`MCP provider "${this.providerName}" loaded ${this.tools.length} tool(s)`);
    }

    public pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    public getName(): string {
        return this.providerName;
    }

    public getDescription(): string {
        return this.providerDescription;
    }

    /**
     * Close the underlying MCP client connection and OAuth2 refresh timer.
     */
    public async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }
}
