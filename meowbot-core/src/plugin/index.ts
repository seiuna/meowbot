import { CommandRegistry } from "@meowbot/command";
import { MessageGateway } from "@meowbot/gateway";
import { getLogger } from "@meowbot/utils/logs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const logger = getLogger("PluginManager");

export interface PluginContext {
    commandRegistry: CommandRegistry;
    messageGateway: MessageGateway;
}

export abstract class Plugin {
    /** Plugin name */
    abstract name: string;
    /** Plugin version */
    abstract version: string;
    /** Plugin description */
    abstract description?: string;

    /** Called when the plugin is loaded */
    abstract onLoad(): Promise<void>;

    /** Called when the plugin is initialized with context */
    abstract onInit(context: PluginContext): Promise<void>;

    /** Called when the plugin is unloaded (optional) */
    onUnload?(): Promise<void>;
}

export class PluginManager {
    private plugins: Plugin[] = [];
    private context?: PluginContext;
    private pluginsDir: string;

    constructor(pluginsDir?: string) {
        this.pluginsDir = pluginsDir ?? resolve(import.meta.dirname, "plugins");
    }

    /**
     * Load all plugins from the plugins directory
     * Scans for subdirectories containing index.ts or index.js
     */
    public async loadPlugins(): Promise<void> {
        logger.info(`Loading plugins from: ${this.pluginsDir}`);

        try {
            const entries = await readdir(this.pluginsDir);
            let loadedCount = 0;

            for (const entry of entries) {
                const entryPath = join(this.pluginsDir, entry);
                const entryStat = await stat(entryPath);

                if (!entryStat.isDirectory()) {
                    continue;
                }

                const plugin = await this.loadPluginFromDirectory(entryPath);
                if (plugin) {
                    this.plugins.push(plugin);
                    loadedCount++;
                }
            }

            logger.info(`Loaded ${loadedCount} plugin(s)`);
        } catch (error: any) {
            if (error.code === "ENOENT") {
                logger.warn(`Plugins directory not found: ${this.pluginsDir}`);
            } else {
                logger.error(`Failed to load plugins: ${error.message}`);
            }
        }
    }

    /**
     * Load a single plugin from a directory
     * @param dirPath Path to the plugin directory
     * @returns Loaded plugin or null if loading failed
     */
    private async loadPluginFromDirectory(dirPath: string): Promise<Plugin | null> {
        const indexTs = join(dirPath, "index.ts");
        const indexJs = join(dirPath, "index.js");

        let pluginPath: string | null = null;

        // Check for index.ts or index.js
        try {
            await stat(indexTs);
            pluginPath = indexTs;
        } catch {
            try {
                await stat(indexJs);
                pluginPath = indexJs;
            } catch {
                logger.debug(`Skipping ${dirPath}: no index.ts or index.js found`);
                return null;
            }
        }

        try {
            const fileUrl = pathToFileURL(pluginPath).href;
            logger.debug(`Loading plugin from: ${pluginPath}`);

            const module = await import(fileUrl);
            const PluginClass = module.default ?? module.Plugin;

            if (!PluginClass) {
                logger.warn(`No default export or Plugin export found in ${pluginPath}`);
                return null;
            }

            const plugin = new PluginClass();

            if (!(plugin instanceof Plugin)) {
                logger.warn(`Export from ${pluginPath} is not an instance of Plugin`);
                return null;
            }

            await plugin.onLoad();
            logger.info(`Plugin loaded: ${plugin.name} v${plugin.version}`);

            return plugin;
        } catch (error: any) {
            logger.error(`Failed to load plugin from ${pluginPath}: ${error.message}`);
            return null;
        }
    }

    /**
     * Initialize all loaded plugins with the given context
     * @param context Plugin context containing registries
     */
    public async initPlugins(context: PluginContext): Promise<void> {
        this.context = context;
        let initializedCount = 0;

        for (const plugin of this.plugins) {
            try {
                await plugin.onInit(context);
                logger.info(`Plugin initialized: ${plugin.name}`);
                initializedCount++;
            } catch (error: any) {
                logger.error(`Failed to initialize plugin ${plugin.name}: ${error.message}`);
            }
        }

        logger.info(`Initialized ${initializedCount} plugin(s)`);
    }

    /**
     * Unload all plugins
     */
    public async unloadPlugins(): Promise<void> {
        for (const plugin of this.plugins) {
            try {
                if (plugin.onUnload) {
                    await plugin.onUnload();
                }
                logger.info(`Plugin unloaded: ${plugin.name}`);
            } catch (error: any) {
                logger.error(`Failed to unload plugin ${plugin.name}: ${error.message}`);
            }
        }

        this.plugins = [];
    }

    /**
     * Get all loaded plugins
     * @returns Array of loaded plugins
     */
    public getPlugins(): Plugin[] {
        return [...this.plugins];
    }

    /**
     * Get a plugin by name
     * @param name Plugin name
     * @returns Plugin or undefined if not found
     */
    public getPlugin(name: string): Plugin | undefined {
        return this.plugins.find(p => p.name === name);
    }

    /**
     * Check if a plugin is loaded
     * @param name Plugin name
     * @returns True if the plugin is loaded
     */
    public hasPlugin(name: string): boolean {
        return this.plugins.some(p => p.name === name);
    }
}