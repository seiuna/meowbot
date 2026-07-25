import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configuration manager interface
 * Defines the contract for loading, saving, and checking configuration keys
 */
export interface IConfigManager {
    /**
     * Load a configuration value by key, returning defaultValue if not found
     * @param key Configuration key
     * @param defaultValue Default value to return if key is not found
     */
    load<T>(key: string, defaultValue: T): T;

    /**
     * Save a configuration value by key
     * @param key Configuration key
     * @param value Value to save
     */
    save<T>(key: string, value: T): Promise<void>;

    /**
     * Check if a configuration key has been registered at runtime
     * @param key Configuration key
     */
    hasKey(key: string): boolean;

    /**
     * Check if a configuration key exists in cache (even if not explicitly registered)
     * @param key Configuration key
     */
    hasKeyInCache(key: string): boolean;
}

/**
 * File-based configuration manager implementation
 * Stores configuration in a JSON file with in-memory caching
 */
export class FileConfigManager implements IConfigManager {
    /** Path to the configuration JSON file */
    private configPath: string;
    /** In-memory configuration cache */
    private cache: Record<string, any> = {};
    /** Whether the cache has unsaved changes */
    private dirty = false;
    /** Set of keys registered at runtime */
    private registeredKeys: Set<string> = new Set();

    /**
     * @param configPath Optional custom path to the configuration file
     *                    Defaults to ../../../config/config.json relative to this module
     */
    constructor(configPath?: string) {
        if (configPath) {
            this.configPath = configPath;
        } else {
            this.configPath = process.env.CONFIG_PATH || path.resolve(fileURLToPath(import.meta.url), "../../../config/config.json");
        }
        this.loadFromFileSync();
    }

    /** Sync load for constructor — fallback if file not yet readable. */
    private loadFromFileSync(): void {
        try {
            if (existsSync(this.configPath)) {
                const raw = readFileSync(this.configPath, "utf8");
                this.cache = JSON.parse(raw);
                this.registeredKeys = new Set(Object.keys(this.cache));
            }
        } catch (error: any) {
            if (error.code !== "ENOENT") {
                console.warn(`[ConfigManager] Failed to load config file (possibly corrupted): ${error}`);
            }
        }
    }

    /**
     * Load configuration from the JSON file into cache
     */
    private async loadFromFile(): Promise<void> {
        try {
            const raw = await readFileSync(this.configPath, "utf8");
            this.cache = JSON.parse(raw);
            this.registeredKeys = new Set(Object.keys(this.cache));
        } catch (error: any) {
            if (error.code !== "ENOENT") {
                console.warn(`[ConfigManager] Failed to load config file (possibly corrupted): ${error}`);
            }
        }
    }

    /**
     * Persist the current cache to the JSON file (async).
     */
    public async saveToFile(): Promise<void> {
        try {
            const dir = path.dirname(this.configPath);
            try { await mkdir(dir, { recursive: true }); } catch {}
            await writeFile(this.configPath, JSON.stringify(this.cache, null, 2), "utf8");
        } catch (error) {
            console.error(`[ConfigManager] Failed to save config file: ${error}`);
        }
    }

    /**
     * Load a configuration value by key
     * @param key Configuration key
     * @param defaultValue Default value if key is not found
     * @returns The stored value or defaultValue
     */
    public load<T>(key: string, defaultValue: T): T {
        this.registeredKeys.add(key);
        if (key in this.cache) {
            return this.cache[key] as T;
        }
        return defaultValue;
    }

    /**
     * Save a configuration value and persist to disk
     * @param key Configuration key
     * @param value Value to save
     */
    public async save<T>(key: string, value: T): Promise<void> {
        this.registeredKeys.add(key);
        this.cache[key] = value;
        await this.saveToFile();
    }

    /**
     * Get all configuration keys registered at runtime
     * @returns Array of registered key names
     */
    public getAllRegisteredKeys(): string[] {
        return Array.from(this.registeredKeys);
    }

    /**
     * Get a snapshot of all registered configuration key-value pairs
     * @returns Object containing all registered configurations
     */
    public getAllConfigs(): Record<string, any> {
        const result: Record<string, any> = {};
        this.registeredKeys.forEach(key => {
            result[key] = this.cache[key];
        });
        return result;
    }

    /**
     * Get configuration groups statistics
     * Groups are determined by the prefix before the first ':' in the key
     * @returns Object mapping group names to arrays of keys
     */
    public getConfigGroups(): Record<string, string[]> {
        const groups: Record<string, string[]> = {};
        this.registeredKeys.forEach(key => {
            const group = key.split(':')[0];
            if (!groups[group]) {
                groups[group] = [];
            }
            groups[group].push(key);
        });
        return groups;
    }

    /**
     * Check if a configuration key has been registered
     * @param key Configuration key
     * @returns true if the key is registered
     */
    public hasKey(key: string): boolean {
        return this.registeredKeys.has(key);
    }

    /**
     * Check if a key exists in cache (even if not explicitly registered via createReactiveConfig)
     * @param key Configuration key
     * @returns true if the key exists in cache
     */
    public hasKeyInCache(key: string): boolean {
        return key in this.cache;
    }

    /**
     * Get all configurations belonging to a specific prefix group
     * @param group Group prefix
     * @returns Object containing matching configurations
     */
    public getGroupConfigs(group: string): Record<string, any> {
        const result: Record<string, any> = {};
        this.registeredKeys.forEach(key => {
            if (key.startsWith(group + ':')) {
                result[key] = this.cache[key];
            }
        });
        return result;
    }

    /**
     * Print a summary of all registered configurations to console
     */
    public printConfigSummary(): void {
        console.log(`Config file path: ${this.configPath}`);
        console.log(`Total registered config items: ${this.registeredKeys.size}`);
        console.log("");
        
        const groups = this.getConfigGroups();
        Object.entries(groups).forEach(([group, keys]) => {
            console.log(`[${group}] (${keys.length} items)`);
            keys.forEach(key => {
                const value = this.cache[key];
                const valueStr = typeof value === 'object' ? JSON.stringify(value).substring(0, 50) : String(value).substring(0, 50);
                console.log(`  - ${key.replace(group + ':', '')}: ${valueStr}...`);
            });
            console.log("");
        });
    }

    /**
     * Set and persist a configuration item (without proxy listener)
     * @param key Configuration key
     * @param value Value to set
     */
    public set<T>(key: string, value: T): void {
        this.registeredKeys.add(key);
        this.cache[key] = value;
        this.saveToFile().catch(err => console.error(`[ConfigManager] save failed: ${err}`));
    }

    /**
     * Get a configuration item (without proxy listener)
     * @param key Configuration key
     * @returns The stored value or undefined
     */
    public get<T>(key: string): T | undefined {
        this.registeredKeys.add(key);
        return this.cache[key] as T | undefined;
    }

    /**
     * Incrementally update partial fields of an object-type configuration
     * @param key Configuration key
     * @param updates Partial fields to merge
     */
    public update<T extends object>(key: string, updates: Partial<T>): void {
        this.registeredKeys.add(key);
        const current = (this.cache[key] as T) || {};
        this.cache[key] = { ...current, ...updates };
        this.saveToFile().catch(err => console.error(`[ConfigManager] save failed: ${err}`));
    }

    /**
     * Delete a configuration item
     * @param key Configuration key
     * @returns true if the key existed and was deleted, false otherwise
     */
    public delete(key: string): boolean {
        if (key in this.cache) {
            delete this.cache[key];
            this.registeredKeys.delete(key);
            this.saveToFile().catch(err => console.error(`[ConfigManager] save failed: ${err}`));
            return true;
        }
        return false;
    }

    /**
     * Clear all configurations (use with caution)
     */
    public clear(): void {
        this.cache = {};
        this.registeredKeys.clear();
        this.saveToFile().catch(err => console.error(`[ConfigManager] save failed: ${err}`));
    }

    /**
     * Batch import and persist configurations
     * @param configs Key-value pairs to import
     */
    public setMultiple(configs: Record<string, any>): void {
        Object.entries(configs).forEach(([key, value]) => {
            this.registeredKeys.add(key);
            this.cache[key] = value;
        });
        this.saveToFile().catch(err => console.error(`[ConfigManager] save failed: ${err}`));
    }

    /**
     * Force reload configuration from disk
     */
    public reload(): void {
        this.loadFromFileSync();
    }
}

/**
 * Mock configuration manager for testing environments
 */
export const mockConfigManager: IConfigManager = {
    load: <T>(key: string, defaultValue: T): T => {
        return defaultValue;
    },
    save: <T>(_key: string, _value: T): Promise<void> => Promise.resolve(),
    hasKey: (key: string): boolean => {
        return false;
    },
    hasKeyInCache: (key: string): boolean => {
        return false;
    }
};

/**
 * Default singleton file configuration manager
 */
export const fileConfigManager = new FileConfigManager();

/**
 * Reactive value interface
 * Provides get/set access with change listeners
 * @template T Value type
 */
export interface Value<T> {
    /** Get the current value */
    get(): T;
    /** Set a new value */
    set(newValue: T): void;
    /** Direct value access */
    value: T;
    /** Register a change listener */
    onChange(listener: (newValue: T, oldValue: T) => void): void;
}

/**
 * Configuration holder implementation
 * Wraps a value with change notification support
 * @template T Value type
 */
class ConfigHolder<T> implements Value<T> {
    /** Current stored value */
    private _value: T;
    /** Registered change listeners */
    private listeners: Array<(newVal: T, oldVal: T) => void> = [];

    /**
     * @param initialValue Initial configuration value
     */
    constructor(initialValue: T) {
        this._value = initialValue;
    }

    /**
     * Get the current value
     * @returns Current value
     */
    public get(): T {
        return this._value;
    }

    /**
     * Set a new value and notify listeners if changed
     * @param newValue New value to set
     */
    public set(newValue: T): void {
        if (this._value !== newValue) {
            const oldValue = this._value;
            this._value = newValue;
            this.notify(newValue, oldValue);
        }
    }

    /**
     * Get the current value via property accessor
     */
    public get value(): T {
        return this.get();
    }

    /**
     * Set a new value via property accessor
     */
    public set value(newValue: T) {
        this.set(newValue);
    }

    /**
     * Register a change listener
     * @param listener Callback invoked with (newValue, oldValue) when value changes
     */
    public onChange(listener: (newValue: T, oldValue: T) => void): void {
        this.listeners.push(listener);
    }

    /**
     * Notify all listeners of a value change
     * @param newValue New value
     * @param oldValue Old value
     */
    private notify(newValue: T, oldValue: T): void {
        this.listeners.forEach(listener => {
            try {
                listener(newValue, oldValue);
            } catch (error) {
                // Silently ignore listener errors
            }
        });
    }

    /**
     * Convert the value to string
     * @returns String representation of the value
     */
    public toString(): string {
        return String(this._value);
    }

    /**
     * Get the primitive value
     * @returns The stored value
     */
    public valueOf(): T {
        return this._value;
    }

    /**
     * Symbol.toPrimitive handler for type coercion
     * @param hint Target type hint ("number", "string", or "default")
     */
    public [Symbol.toPrimitive](hint: string): T | number | string {
        if (hint === 'number') return Number(this._value);
        if (hint === 'string') return String(this._value);
        return this._value;
    }
}

/**
 * Create a reactive configuration value
 * Loads the initial value from the manager and auto-persists on change
 * @param key Configuration key
 * @param defaultValue Default value if key is not found
 * @param manager Configuration manager implementation (defaults to fileConfigManager)
 * @returns Reactive Value instance
 */
export function createConfig<T>(key: string, defaultValue: T, manager: IConfigManager = fileConfigManager): Value<T> {
    const initialValue = manager.load(key, defaultValue);
    const holder = new ConfigHolder<T>(initialValue);

    holder.onChange((newValue) => {
        manager.save(key, newValue);
    });

    return holder;
}

/**
 * Create a reactive object configuration
 * Returns a Proxy that auto-validates and persists changes
 * @param key Configuration key (建议采用 group:key format)
 * @param defaultObj Default object value
 * @param schema Optional Zod-like validation schema
 * @param onChange Callback invoked when configuration changes
 * @param manager Configuration manager implementation (defaults to fileConfigManager)
 * @param autoSave Whether to auto-save the default value on first creation if not in file
 * @returns Proxied object with auto-validation and persistence
 */
export function createReactiveConfig<T extends object>(
    key: string,
    defaultObj: T,
    schema?: { safeParse: (data: any) => { success: boolean; data?: any; error?: any } },
    onChange: (value: T) => void = (_) => {},
    manager: IConfigManager = fileConfigManager,
    autoSave: boolean = true
): T {
    // Check if the key already exists in the config file
    const existsInFile = manager.hasKeyInCache(key);

    let initialData = manager.load(key, defaultObj);

    // Validate and parse with schema if provided
    if (schema) {
        const result = schema.safeParse(initialData);
        if (result.success) {
            initialData = result.data;
        } else {
            console.error(`[Config] Config ${key} validation failed, using default:`, result.error.format());
            initialData = defaultObj;
        }
    }

    // Auto-save default value to disk on first creation (if not already in file)
    if (autoSave && !existsInFile) {
        manager.save(key, initialData);
        console.log(`[Config] Initialized default reactive config: ${key}`);
    }

    return new Proxy(initialData, {
        get(target, prop) {
            return Reflect.get(target, prop);
        },
        set(target, prop, newValue) {
            const oldValue = Reflect.get(target, prop);
            // Only proceed if the value actually changed
            if (oldValue !== newValue) {
                // Validate with schema before applying the change
                const nextTarget = { ...target, [prop]: newValue };
                if (schema) {
                    const result = schema.safeParse(nextTarget);
                    if (!result.success) {
                        console.error(`[Config] Failed to set ${key}.${String(prop)}:`, result.error.format());
                        return false;
                    }
                }

                Reflect.set(target, prop, newValue);
                if (autoSave) {
                    manager.save(key, target);
                }
                // Only call onChange after successful update
                if (onChange) onChange(target);
            }
            return true;
        }
    });
}
