import fs from "node:fs/promises";
import path from "node:path";
import {getLogger} from "@meowbot/utils/logs";

const logger = getLogger("Workspace");

// ── Types ──

export interface WorkspaceConfig {
    id: string;
    name: string;
    desc?: string;
}

export interface FileEdit {
    search: string;
    replace: string;
}

// ── Abstract Workspace ──

export abstract class Workspace {
    constructor(public readonly config: WorkspaceConfig) {}

    abstract listFiles(): Promise<string[]>;

    /**
     * List immediate children of a directory within the workspace.
     * Returns entries sorted: directories first, then alphabetically by name.
     */
    abstract listDirectory(dirPath?: string): Promise<{ name: string; type: "file" | "dir"; path: string }[]>;

    abstract readFile(filePath: string): Promise<string>;

    /**
     * Read a file as a raw Buffer (binary-safe).
     * Subclasses MUST override this for proper binary support.
     * Default implementation throws — callers should use a concrete workspace.
     */
    async readFileRaw(filePath: string): Promise<Buffer> {
        throw new Error(`readFileRaw not implemented for this workspace type. Use LocalWorkspace instead.`);
    }

    abstract writeFile(filePath: string, content: string, append?: boolean): Promise<void>;

    abstract deleteFile(filePath: string): Promise<void>;

    abstract exists(filePath: string): Promise<boolean>;

    abstract patchFile(filePath: string, edits: FileEdit[]): Promise<string>;
}

// ── Local Workspace ──

export class LocalWorkspace extends Workspace {
    private readonly rootDir: string;
    /** File listing cache: timestamp → file list. TTL: 30 seconds. */
    private fileListCache: { at: number; files: string[] } | null = null;
    private static readonly FILE_LIST_TTL_MS = 30_000;
    /** Max file size for readFile (10 MB). Larger files are rejected. */
    private static readonly MAX_READ_SIZE = 10 * 1024 * 1024;

    constructor(config: WorkspaceConfig, rootDir: string) {
        super(config);
        this.rootDir = path.resolve(rootDir);
    }

    /**
     * Resolve and validate a path against the workspace root.
     * Prevents directory traversal attacks (e.g., ../../../etc/passwd).
     */
    private getSafePath(targetPath: string): string {
        const resolvedPath = path.resolve(this.rootDir, targetPath);

        // Critical defense: if resolved path doesn't start with rootDir, it's a traversal attempt
        if (!resolvedPath.startsWith(this.rootDir)) {
            throw new Error(`Security Violation: 拒绝访问。路径 [${targetPath}] 试图跳出工作区。`);
        }

        return resolvedPath;
    }

    async listFiles(): Promise<string[]> {
        // Return cached result if still fresh
        if (this.fileListCache && (Date.now() - this.fileListCache.at) < LocalWorkspace.FILE_LIST_TTL_MS) {
            return this.fileListCache.files;
        }

        const results: string[] = [];

        const walk = async (dir: string): Promise<void> => {
            const entries = await fs.readdir(dir, {withFileTypes: true});
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(this.rootDir, fullPath);

                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        await walk(fullPath);
                    }
                } else {
                    results.push(relativePath);
                }
            }
        };

        await walk(this.rootDir);

        // Update cache
        this.fileListCache = { at: Date.now(), files: results };
        return results;
    }

    /** Invalidate the file listing cache (e.g. after write/delete). */
    private invalidateCache(): void {
        this.fileListCache = null;
    }

    async listDirectory(dirPath = ""): Promise<{ name: string; type: "file" | "dir"; path: string }[]> {
        const safeDir = this.getSafePath(dirPath);
        const entries = await fs.readdir(safeDir, { withFileTypes: true });
        const items: { name: string; type: "file" | "dir"; path: string }[] = [];
        for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            const absPath = path.join(safeDir, e.name);
            const relPath = path.relative(this.rootDir, absPath).replace(/\\/g, '/');
            items.push({ name: e.name, type: e.isDirectory() ? "dir" : "file", path: relPath });
        }
        items.sort((a, b) => (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1) || a.name.localeCompare(b.name));
        return items;
    }

    async readFile(filePath: string): Promise<string> {
        const safePath = this.getSafePath(filePath);
        // Size check to prevent OOM
        const stat = await fs.stat(safePath);
        if (stat.size > LocalWorkspace.MAX_READ_SIZE) {
            const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
            throw new Error(
                `File too large (${sizeMB} MB). Max read size is 10 MB. ` +
                `Use offset/limit to read this file in chunks, or use a different tool for large files.`
            );
        }
        return fs.readFile(safePath, "utf-8");
    }

    /**
     * Read a file as a raw Buffer (binary-safe).
     */
    async readFileRaw(filePath: string): Promise<Buffer> {
        const safePath = this.getSafePath(filePath);
        return fs.readFile(safePath);
    }

    async writeFile(filePath: string, content: string, append = false): Promise<void> {
        const safePath = this.getSafePath(filePath);

        // Ensure parent directory exists
        const dir = path.dirname(safePath);
        await fs.mkdir(dir, {recursive: true});

        if (append) {
            await fs.appendFile(safePath, content, "utf-8");
        } else {
            await fs.writeFile(safePath, content, "utf-8");
        }
        this.invalidateCache();

        logger.info(`[${this.config.name}] Wrote file: ${filePath}`);
    }

    async deleteFile(filePath: string): Promise<void> {
        const safePath = this.getSafePath(filePath);
        await fs.unlink(safePath);
        this.invalidateCache();
        logger.info(`[${this.config.name}] Deleted file: ${filePath}`);
    }

    async exists(filePath: string): Promise<boolean> {
        const safePath = this.getSafePath(filePath);
        try {
            await fs.access(safePath);
            return true;
        } catch {
            return false;
        }
    }

    async patchFile(filePath: string, edits: FileEdit[]): Promise<string> {
        const safePath = this.getSafePath(filePath);

        let content: string;
        try {
            content = await fs.readFile(safePath, "utf-8");
        } catch {
            // If file doesn't exist and there's at least one edit, create with first replacement
            if (edits.length > 0) {
                const newContent = edits[0].replace;
                await this.writeFile(filePath, newContent);
                return newContent;
            }
            throw new Error(`File not found: ${filePath}`);
        }

        // Apply edits in order — use replaceAll for each search term
        for (const edit of edits) {
            if (!content.includes(edit.search)) {
                throw new Error(`Edit failed: search string not found in ${filePath}`);
            }
            content = content.replaceAll(edit.search, edit.replace);
        }

        await fs.writeFile(safePath, content, "utf-8");
        this.invalidateCache();
        logger.info(`[${this.config.name}] Patched file: ${filePath} (${edits.length} edits)`);

        return content;
    }

    /** Get the absolute root directory of this workspace. */
    getRootPath(): string {
        return this.rootDir;
    }

    /** Get a relative path from the workspace root. */
    getRelativePath(absolutePath: string): string {
        return path.relative(this.rootDir, absolutePath);
    }
}

// ── Read-Only Workspace Wrapper ──

/**
 * Wraps any workspace and blocks all write operations.
 * Useful for exposing skill directories as browsable workspaces
 * without allowing the LLM to modify them.
 */
export class ReadOnlyWorkspace extends Workspace {
    constructor(private readonly inner: Workspace) {
        super(inner.config);
    }

    listFiles(): Promise<string[]> { return this.inner.listFiles(); }
    listDirectory(dirPath?: string) { return this.inner.listDirectory(dirPath); }
    readFile(filePath: string): Promise<string> { return this.inner.readFile(filePath); }
    readFileRaw(filePath: string): Promise<Buffer> { return this.inner.readFileRaw(filePath); }
    exists(filePath: string): Promise<boolean> { return this.inner.exists(filePath); }

    async writeFile(): Promise<void> {
        throw new Error(`Workspace "${this.config.id}" is read-only.`);
    }
    async deleteFile(): Promise<void> {
        throw new Error(`Workspace "${this.config.id}" is read-only.`);
    }
    async patchFile(): Promise<string> {
        throw new Error(`Workspace "${this.config.id}" is read-only.`);
    }
}

// ── Workspace Manager (Singleton) ──

export class WorkspaceManager {
    private static instance: WorkspaceManager | null = null;
    private workspaces = new Map<string, Workspace>();

    static getInstance(): WorkspaceManager {
        if (!WorkspaceManager.instance) {
            WorkspaceManager.instance = new WorkspaceManager();
        }
        return WorkspaceManager.instance;
    }

    private constructor() {}

    /**
     * Register a workspace.
     * @returns The registered workspace instance.
     */
    register(workspace: Workspace): Workspace {
        if (this.workspaces.has(workspace.config.id)) {
            throw new Error(`Workspace already registered: ${workspace.config.id}`);
        }
        this.workspaces.set(workspace.config.id, workspace);
        logger.info(`Registered workspace: ${workspace.config.id} (${workspace.config.name})`);
        return workspace;
    }

    /**
     * Unregister a workspace by ID.
     */
    unregister(id: string): boolean {
        const deleted = this.workspaces.delete(id);
        if (deleted) {
            logger.info(`Unregistered workspace: ${id}`);
        }
        return deleted;
    }

    /**
     * Get a workspace by ID.
     */
    get(id: string): Workspace | undefined {
        return this.workspaces.get(id);
    }

    /**
     * Get or throw if workspace not found.
     */
    getOrThrow(id: string): Workspace {
        const workspace = this.workspaces.get(id);
        if (!workspace) {
            throw new Error(`Workspace not found: ${id}`);
        }
        return workspace;
    }

    /**
     * Check if a workspace is registered.
     */
    has(id: string): boolean {
        return this.workspaces.has(id);
    }

    /**
     * List all registered workspace IDs.
     */
    list(): string[] {
        return Array.from(this.workspaces.keys());
    }

    /**
     * Create and register a local workspace.
     */
    createLocal(id: string, name: string, rootDir: string, desc?: string): LocalWorkspace {
        const config: WorkspaceConfig = {id, name, desc};
        const workspace = new LocalWorkspace(config, rootDir);
        return this.register(workspace) as LocalWorkspace;
    }

    /**
     * Create a child workspace under an existing parent workspace.
     * The child workspace will be created as a subdirectory of the parent workspace.
     * @param parentId - ID of the parent workspace
     * @param childId - ID for the new child workspace
     * @param childName - Name for the child workspace
     * @param subDir - Subdirectory name within the parent workspace
     * @param desc - Optional description for the child workspace
     * @returns The created child LocalWorkspace
     */
    createChild(parentId: string, childId: string, childName: string, subDir: string, desc?: string): LocalWorkspace {
        const parent = this.getOrThrow(parentId);

        if (!(parent instanceof LocalWorkspace)) {
            throw new Error(`Cannot create child workspace: parent "${parentId}" is not a LocalWorkspace`);
        }

        if (this.has(childId)) {
            throw new Error(`Workspace already registered: ${childId}`);
        }

        const parentRoot = parent.getRootPath();
        const childRoot = path.join(parentRoot, subDir);

        // Ensure the subdirectory is within the parent workspace
        const resolvedChildRoot = path.resolve(childRoot);
        if (!resolvedChildRoot.startsWith(parentRoot)) {
            throw new Error(`Security Violation: 子工作区路径试图跳出父工作区。`);
        }

        const config: WorkspaceConfig = {id: childId, name: childName, desc};
        const childWorkspace = new LocalWorkspace(config, resolvedChildRoot);
        return this.register(childWorkspace) as LocalWorkspace;
    }
}
