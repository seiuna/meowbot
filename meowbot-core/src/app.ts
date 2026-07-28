/**
 * Application entry point
 * Handles all registration, initialization, and startup logic
 */

// Load .env BEFORE any other imports
import "dotenv/config";

import { bootstrapCommandRegistry, commandRegistry } from "./command/dispatcher.js";
import { bootstrapDatabase, shutdownDatabase } from "./database/init.js";
import { bootstrapAgentRegistry } from "./agent/bootstrap.js";
import { bootstrapMessageGateway, messageGateway } from "./gateway/index.js";
import { PluginManager } from "./plugin/index.js";
import { getLogger } from "./utils/logs.js";
import { resolve } from "node:path";
import { toolRegistry } from "./tools/tool_registry.js";
import { bootstrapMCPProviders } from "./mcp/index.js";
import { AppServer } from "./server/index.js";
import { SubagentToolProvider } from "./tools/subagent/index.js";
import { WorkspaceToolProvider } from "./workspace/index.js";
import { SystemToolProvider } from "./tools/system/system_tools.js";
import { ScheduledToolProvider } from "./tools/scheduled_tools.js";
import { UserInterventionToolProvider } from "./tools/user/user_tools.js";
import { NotificationToolProvider } from "./tools/user/notification_tools.js";
import { UserProfileToolProvider } from "./social/user_profile_tools.js";
import { DynamicToolsProvider } from "./tools/dynamic_tools.js";
import { CommandToolProvider } from "./tools/command/command_tools.js";
import { SkillToolProvider } from "./tools/skill/skill_tools.js";
import { getVectorRetriever } from "./vector/index.js";
import { WorkspaceManager, LocalWorkspace, ReadOnlyWorkspace } from "./workspace/index.js";
import { BootstrapKeyManager } from "./permission/bootstrap_key.js";


const logger = getLogger("App");

const pluginManager = new PluginManager();

export async function startApp(): Promise<void> {
    // Global fetch proxy via undici — only if HTTP_PROXY env var is set
    const proxyUrl = process.env.HTTP_PROXY;
    if (proxyUrl) {
        const { ProxyAgent, setGlobalDispatcher } = await import("undici");
        setGlobalDispatcher(new ProxyAgent(proxyUrl));
        logger.info(`Proxy enabled: ${proxyUrl}`);
    }

    logger.info("Starting application...");
    await bootstrapDatabase();

    // Generate bootstrap registration key
    BootstrapKeyManager.getInstance().generate();

    // Register tool providers BEFORE server starts or agents
    toolRegistry.register(new DynamicToolsProvider());
    toolRegistry.register(new SubagentToolProvider());
    toolRegistry.register(new WorkspaceToolProvider());
    toolRegistry.register(new SystemToolProvider());
    toolRegistry.register(new ScheduledToolProvider());
    toolRegistry.register(new UserInterventionToolProvider());
    toolRegistry.register(new NotificationToolProvider());
    toolRegistry.register(new CommandToolProvider());
    toolRegistry.register(new SkillToolProvider());
    toolRegistry.register(new UserProfileToolProvider());

    // Register workspace
    const wsManager = WorkspaceManager.getInstance();
    wsManager.register(new LocalWorkspace({
        id: "meowbot",
        name: "MeowBot Project",
        desc: "Prompts, skills, and project config",
    }, "../workspace"));

    // Register agent workspaces (for sub-agent browsing)
    const agentsDir = resolve(import.meta.dirname, "..", "..", "agents");
    const { readdirSync, statSync, readFileSync } = await import("node:fs");
    try {
        for (const entry of readdirSync(agentsDir)) {
            const entryPath = resolve(agentsDir, entry);
            if (!statSync(entryPath).isDirectory() || entry.startsWith(".")) continue;
            const agentMdPath = resolve(entryPath, "AGENT.md");
            let asSubAgent = false;
            try {
                const raw = readFileSync(agentMdPath, "utf-8").replace(/\r\n/g, "\n");
                const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
                if (fmMatch) {
                    const asMatch = fmMatch[1].match(/^as_sub_agent:\s*(.+)$/m);
                    if (asMatch) asSubAgent = asMatch[1].trim().toLowerCase() !== "false";
                }
            } catch {}
            if (!asSubAgent) continue;
            wsManager.register(new ReadOnlyWorkspace(new LocalWorkspace({
                id: "agent-" + entry, name: "Agent: " + entry,
                desc: "Read-only agent directory: " + entry,
            }, entryPath)));
        }
    } catch {}

    // Load MCP tool providers
    await bootstrapMCPProviders(toolRegistry);

    // Bootstrap agents BEFORE server starts listening
    await bootstrapAgentRegistry();

    // Bootstrap vector search (indexes all tools)
    try {
        await getVectorRetriever().bootstrap();
    } catch (e) {
        logger.warn("Vector retriever bootstrap failed (non-fatal):", e);
    }

    await AppServer.getInstance().start();
    await bootstrapMessageGateway();
    await bootstrapCommandRegistry();

    // Load plugins after core services are ready
    await pluginManager.loadPlugins();

    // Initialize plugins with context
    await pluginManager.initPlugins({
        commandRegistry,
        messageGateway,
    });

    logger.info("Application started successfully");
}

export async function shutdownApp(): Promise<void> {
    logger.info("Shutting down application...");

    // Unload plugins first
    try { await pluginManager.unloadPlugins(); } catch (e) { logger.error("Plugin unload error:", e); }
    logger.info("Plugins unloaded");

    try { await shutdownDatabase(); } catch (e) { logger.error("DB shutdown error:", e); }
    logger.info("Database disconnected");

    try { await AppServer.getInstance().stop(); } catch (e) { logger.error("Server stop error:", e); }
    logger.info("Server stopped");
    logger.info("Application shutdown complete");
}

process.on("SIGINT", async () => {
    logger.info("Received SIGINT signal");
    await shutdownApp();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM signal");
    await shutdownApp();
    process.exit(0);
});

startApp();

