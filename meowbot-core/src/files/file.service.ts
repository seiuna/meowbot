/**
 * FileService
 *
 * Unified file access layer. Resolves a fileId to base64 data or Buffer,
 * regardless of whether the file originated from an adapter (QQ, etc.)
 * or the workspace filesystem.
 *
 * fileId schemes:
 *   file_<uuid>           — adapter file, registered via register()
 *   ws/<workspaceId>/<path> — workspace file, resolved deterministically
 */

import { randomUUID } from "crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getLogger } from "../utils/logs.js";
import { FileMeta } from "./types.js";
import type { BaseFile } from "../gateway/adapters/types.js";
import { WorkspaceManager } from "../workspace/workspace.js";

const logger = getLogger("FileService");

// ── MIME detection ──

const MIME_MAP: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
};

function detectMime(filePath: string): string {
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    return MIME_MAP[ext] ?? "application/octet-stream";
}

// ── FileRecord — in-memory file backed by a Buffer ──

class FileRecord {
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;
    private buffer: Buffer;

    constructor(buffer: Buffer, name: string, mimeType?: string) {
        this.buffer = buffer;
        this.name = name;
        this.mimeType = mimeType ?? detectMime(name);
        this.size = buffer.length;
    }

    async toBuffer(): Promise<Buffer> { return this.buffer; }
    async toBase64(): Promise<string> {
        return `data:${this.mimeType};base64,${this.buffer.toString("base64")}`;
    }
}

// ── Registry ──

interface FileLike {
    toBuffer(): Promise<Buffer>;
    toBase64(): Promise<string>;
}

interface RegistryEntry {
    file: FileLike;
    meta: FileMeta;
}

// ── FileService ──

export class FileService {
    private static instance: FileService;

    /** File registry: fileId → { file, meta } */
    private registry = new Map<string, RegistryEntry>();

    private constructor() {}

    public static getInstance(): FileService {
        if (!FileService.instance) {
            FileService.instance = new FileService();
        }
        return FileService.instance;
    }

    public static resetInstance(): void {
        FileService.instance = undefined as unknown as FileService;
    }

    // ═══════════════════════════════════════════════════════════
    //  Registration — adapter files
    // ═══════════════════════════════════════════════════════════

    /**
     * Register a BaseFile from an adapter event.
     */
    public register(baseFile: BaseFile, mimeType?: string): string {
        const fileId = this.makeFileId();
        const name = baseFile.getFileName() ?? "unknown";
        const resolvedMime = mimeType ?? detectMime(name);

        const meta: FileMeta = {
            fileId,
            name,
            size: baseFile.getFileSize() ?? 0,
            mimeType: resolvedMime,
            source: "adapter",
            createdAt: new Date(),
        };

        this.registry.set(fileId, {
            file: {
                toBuffer: () => baseFile.toBuffer(),
                toBase64: () => baseFile.toBase64(),
            },
            meta,
        });
        logger.info(`Registered adapter file: ${fileId} (${name}, ${resolvedMime})`);
        return fileId;
    }

    public registerAll(files: BaseFile[]): Map<string, FileMeta> {
        const result = new Map<string, FileMeta>();
        for (const file of files) {
            const fileId = this.register(file);
            result.set(fileId, this.registry.get(fileId)!.meta);
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════
    //  Registration — synthetic files (local path / URL / Buffer / base64)
    // ═══════════════════════════════════════════════════════════

    /**
     * Register a file from a local filesystem path. Reads the file into memory.
     * @returns fileId
     */
    public async fromLocalPath(filePath: string, mimeType?: string): Promise<string> {
        const buffer = await readFile(filePath);
        const name = basename(filePath);
        return this.fromInternal(new FileRecord(buffer, name, mimeType));
    }

    /**
     * Register a file from a remote URL. Downloads immediately and caches in memory.
     * @returns fileId
     */
    public async fromUrl(url: string, mimeType?: string): Promise<string> {
        const response = await fetch(url, {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MEOWBOT/1.0" },
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch URL: ${response.status} ${url}`);
        }

        const ab = await response.arrayBuffer();
        const buffer = Buffer.from(ab);

        let name: string;
        try {
            name = basename(new URL(url).pathname) || "download";
        } catch {
            name = "download";
        }

        const resolvedMime = mimeType ?? response.headers.get("content-type") ?? detectMime(name);
        return this.fromInternal(new FileRecord(buffer, name, resolvedMime));
    }

    /**
     * Register a file from a raw Buffer.
     * @returns fileId
     */
    public fromBuffer(buffer: Buffer, name: string, mimeType?: string): string {
        return this.fromInternal(new FileRecord(buffer, name, mimeType));
    }

    /**
     * Register a file from a base64-encoded string or data URI.
     *
     * Accepts:
     *   - "data:image/png;base64,iVBORw0KGgo..." (parses MIME from prefix)
     *   - "iVBORw0KGgo..." (raw base64, falls back to mimeType param or name)
     *
     * @returns fileId
     */
    public fromBase64(input: string, name: string, mimeType?: string): string {
        let resolvedMime = mimeType ?? "application/octet-stream";
        let raw = input;

        const dataUriMatch = input.match(/^data:([^;]*);base64,(.+)$/is);
        if (dataUriMatch) {
            if (!mimeType) resolvedMime = dataUriMatch[1] || resolvedMime;
            raw = dataUriMatch[2];
        }

        const buffer = Buffer.from(raw, "base64");
        return this.fromInternal(new FileRecord(buffer, name, resolvedMime));
    }

    private fromInternal(record: FileRecord): string {
        const fileId = this.makeFileId();
        const meta: FileMeta = {
            fileId,
            name: record.name,
            size: record.size,
            mimeType: record.mimeType,
            source: "adapter",
            createdAt: new Date(),
        };
        this.registry.set(fileId, { file: record, meta });
        logger.info(`Registered file: ${fileId} (${record.name}, ${record.mimeType}, ${record.size} bytes)`);
        return fileId;
    }

    // ═══════════════════════════════════════════════════════════
    //  Retrieval
    // ═══════════════════════════════════════════════════════════

    public async getBase64(fileId: string): Promise<string | null> {
        try {
            if (fileId.startsWith("file_")) return await this.getRegistryBase64(fileId);
            if (fileId.startsWith("ws/")) return await this.getWorkspaceBase64(fileId);
            // Fallback: pass through raw URLs
            if (fileId.startsWith("http://") || fileId.startsWith("https://")) return fileId;
            logger.warn(`Unknown fileId scheme: ${fileId}`);
            return null;
        } catch (error) {
            logger.error(`Failed to get base64 for ${fileId}: ${error}`);
            return null;
        }
    }

    public async getBuffer(fileId: string): Promise<Buffer | null> {
        try {
            if (fileId.startsWith("file_")) return await this.getRegistryBuffer(fileId);
            if (fileId.startsWith("ws/")) return await this.getWorkspaceBuffer(fileId);
            logger.warn(`Unknown fileId scheme: ${fileId}`);
            return null;
        } catch (error) {
            logger.error(`Failed to get buffer for ${fileId}: ${error}`);
            return null;
        }
    }

    public getMeta(fileId: string): FileMeta | null {
        if (fileId.startsWith("file_")) {
            const entry = this.registry.get(fileId);
            return entry ? { ...entry.meta } : null;
        }
        if (fileId.startsWith("ws/")) {
            const parsed = this.parseWorkspaceFileId(fileId);
            if (!parsed) return null;
            return {
                fileId,
                name: parsed.filePath.split("/").pop() ?? "unknown",
                size: 0,
                mimeType: detectMime(parsed.filePath),
                source: "workspace",
                createdAt: new Date(0),
            };
        }
        return null;
    }

    public listFiles(): FileMeta[] {
        return Array.from(this.registry.values()).map(e => ({ ...e.meta }));
    }

    /** @deprecated Use listFiles() instead. */
    public listAdapterFiles(): FileMeta[] { return this.listFiles(); }

    public unregister(fileId: string): boolean {
        const deleted = this.registry.delete(fileId);
        if (deleted) logger.debug(`Unregistered file: ${fileId}`);
        return deleted;
    }

    public clear(): void {
        this.registry.clear();
        logger.debug("Cleared all registered files");
    }

    // ═══════════════════════════════════════════════════════════
    //  Private helpers
    // ═══════════════════════════════════════════════════════════

    private makeFileId(): string {
        return `file_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
    }

    private async getRegistryBase64(fileId: string): Promise<string | null> {
        const entry = this.registry.get(fileId);
        if (!entry) { logger.warn(`File not found: ${fileId}`); return null; }
        return entry.file.toBase64();
    }

    private async getRegistryBuffer(fileId: string): Promise<Buffer | null> {
        const entry = this.registry.get(fileId);
        if (!entry) { logger.warn(`File not found: ${fileId}`); return null; }
        return entry.file.toBuffer();
    }

    // ── Private: Workspace file access ──

    /**
     * Parse a workspace fileId of the form "ws/<workspaceId>/<relativePath>".
     */
    private parseWorkspaceFileId(fileId: string): { workspaceId: string; filePath: string } | null {
        // Strip "ws/" prefix
        const rest = fileId.slice(3);
        const slashIdx = rest.indexOf("/");
        if (slashIdx === -1) return null;

        return {
            workspaceId: rest.substring(0, slashIdx),
            filePath: rest.substring(slashIdx + 1),
        };
    }

    private async getWorkspaceBuffer(fileId: string): Promise<Buffer | null> {
        const parsed = this.parseWorkspaceFileId(fileId);
        if (!parsed) {
            logger.warn(`Invalid workspace fileId: ${fileId}`);
            return null;
        }

        const ws = WorkspaceManager.getInstance().get(parsed.workspaceId);
        if (!ws) {
            logger.warn(`Workspace not found: ${parsed.workspaceId}`);
            return null;
        }

        try {
            return await ws.readFileRaw(parsed.filePath);
        } catch (error) {
            logger.error(`Failed to read workspace file ${fileId}: ${error}`);
            return null;
        }
    }

    private async getWorkspaceBase64(fileId: string): Promise<string | null> {
        const buffer = await this.getWorkspaceBuffer(fileId);
        if (!buffer) return null;

        const parsed = this.parseWorkspaceFileId(fileId);
        const mime = parsed ? detectMime(parsed.filePath) : "application/octet-stream";
        return `data:${mime};base64,${buffer.toString("base64")}`;
    }
}

export function getFileService(): FileService {
    return FileService.getInstance();
}
