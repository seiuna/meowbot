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

import { randomUUID, createHash } from "crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import sharp from "sharp";
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

// ── Image conversion ──

/** Supported target image formats for auto-conversion. Order matters: first is the default fallback. */
const IMAGE_FORMATS = ["png", "jpeg", "gif", "webp"] as const;

type ImageFormat = keyof typeof FORMAT_MIME;
/** MIME type mapping for image formats */
const FORMAT_MIME = {
    png: "image/png",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
} as const;

type ImageMime = typeof FORMAT_MIME[ImageFormat]; 

function normalizeFormat(raw: string): ImageFormat {
    const normalized = raw.toLowerCase().replace("jpg", "jpeg");
    if (IMAGE_FORMATS.includes(normalized as ImageFormat)) return normalized as ImageFormat;
    return IMAGE_FORMATS[0]; // fallback to first (png)
}

function mimeToFormat(mime: string): ImageFormat | null {
    for (const [fmt, m] of Object.entries(FORMAT_MIME)) {
        if (mime.includes(m)) return fmt as ImageFormat;
    }
    return null;
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

// ── Download result ──

interface DownloadResult {
    dataUri: string;
    mime: string;
    buffer: Buffer;
}

// ── FileService ──

export class FileService {
    private static instance: FileService;

    /** File registry: fileId → { file, meta } */
    private registry = new Map<string, RegistryEntry>();

    /** Conversion cache: `${fileId}:${targetFormat}` → base64 data URI */
    private convertCache = new Map<string, string>();

    /** Download cache: URL → DownloadResult (avoids re-downloading) */
    private downloadCache = new Map<string, DownloadResult>();

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

    public async getBase64(
        fileId: string,
        options?: { accept?: ImageMime[] },
    ): Promise<string | null> {
        try {
            const file = await this.download(fileId);
            if (!file) return null;

            // No format requirement — return original
            if (!options?.accept?.length) return file.dataUri;

            // Original format is in the accept list — return as-is
            if (options.accept.includes(file.mime as ImageMime)) return file.dataUri;

            // Convert to the first accepted format
            return this.convertBase64(file.dataUri, normalizeFormat(options.accept[0]));
        } catch (error) {
            logger.error(`Failed to get base64 for ${fileId}: ${error}`);
            return null;
        }
    }

    public async getBuffer(fileId: string): Promise<Buffer | null> {
        try {
            const file = await this.download(fileId);
            return file?.buffer ?? null;
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

    /**
     * Check whether a file exists and is readable without loading its content.
     *
     * - `file_*` — checks in-memory registry
     * - `ws/*` — checks filesystem via `access()`
     * - `http://` / `https://` — sends a HEAD request
     */
    public async isAvailable(fileId: string): Promise<boolean> {
        if (fileId.startsWith("file_")) return this.registry.has(fileId);

        if (fileId.startsWith("ws/")) {
            const parsed = this.parseWorkspaceFileId(fileId);
            if (!parsed) return false;
            const ws = WorkspaceManager.getInstance().get(parsed.workspaceId);
            if (!ws) return false;
            try {
                return await ws.exists(parsed.filePath);
            } catch {
                return false;
            }
        }

        if (fileId.startsWith("http://") || fileId.startsWith("https://")) {
            try {
                const head = await fetch(fileId, { method: "HEAD", signal: AbortSignal.timeout(5000) });
                return head.ok;
            } catch {
                return false;
            }
        }

        return false;
    }

    public clear(): void {
        this.registry.clear();
        logger.debug("Cleared all registered files");
    }

    // ═══════════════════════════════════════════════════════════
    //  Unified download
    // ═══════════════════════════════════════════════════════════

    /**
     * Unified download entry point.
     *
     * Resolves any fileId scheme to a {@link DownloadResult} containing
     * the data URI, original MIME type, and raw Buffer.
     *
     * Results from URL downloads are cached to avoid redundant network requests.
     */
    private async download(fileId: string): Promise<DownloadResult | null> {
        // URL downloads are cached
        if (fileId.startsWith("http://") || fileId.startsWith("https://")) {
            const cached = this.downloadCache.get(fileId);
            if (cached) return cached;

            try {
                const resp = await fetch(fileId, {
                    signal: AbortSignal.timeout(30000),
                });
                if (!resp.ok) return null;
                const buffer = Buffer.from(await resp.arrayBuffer());
                const mime = resp.headers.get("content-type") ?? "application/octet-stream";
                const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;
                const result: DownloadResult = { dataUri, mime, buffer };

                // Cache (cap at 50 entries)
                if (this.downloadCache.size >= 50) {
                    const firstKey = this.downloadCache.keys().next().value;
                    if (firstKey) this.downloadCache.delete(firstKey);
                }
                this.downloadCache.set(fileId, result);
                return result;
            } catch {
                return null;
            }
        }

        // Registry files
        if (fileId.startsWith("file_")) {
            const entry = this.registry.get(fileId);
            if (!entry) { logger.warn(`File not found: ${fileId}`); return null; }
            const buffer = await entry.file.toBuffer();
            const dataUri = await entry.file.toBase64();
            return { dataUri, mime: entry.meta.mimeType, buffer };
        }

        // Workspace files
        if (fileId.startsWith("ws/")) {
            const buffer = await this.getWorkspaceBuffer(fileId);
            if (!buffer) return null;
            const parsed = this.parseWorkspaceFileId(fileId);
            const mime = parsed ? detectMime(parsed.filePath) : "application/octet-stream";
            return {
                dataUri: `data:${mime};base64,${buffer.toString("base64")}`,
                mime,
                buffer,
            };
        }

        logger.warn(`Unknown fileId scheme: ${fileId}`);
        return null;
    }

    /**
     * Convert a base64 data URI to the target image format.
     * Caches results by full content hash → target format.
     */
    private async convertBase64(
        dataUri: string,
        targetFormat: ImageFormat,
    ): Promise<string> {
        const targetMime = FORMAT_MIME[targetFormat];

        // Parse source
        const match = dataUri.match(/^data:([^;]*);base64,(.+)$/is);
        if (!match) {
            logger.warn("Cannot convert: not a valid data URI");
            return dataUri;
        }

        const sourceMime = match[1];
        const sourceFormat = mimeToFormat(sourceMime);

        // Already the target format — no conversion needed
        if (sourceFormat === targetFormat) return dataUri;

        const rawBase64 = match[2];
        const hash = createHash("sha256").update(rawBase64).digest("hex");
        const cacheKey = `${hash}:${targetFormat}`;

        // Check conversion cache
        const cached = this.convertCache.get(cacheKey);
        if (cached) return cached;

        try {
            const inputBuffer = Buffer.from(rawBase64, "base64");
            let sharpInstance = sharp(inputBuffer);

            // Apply format-specific options
            switch (targetFormat) {
                case "jpeg":
                    sharpInstance = sharpInstance.jpeg({ quality: 90 });
                    break;
                case "png":
                    sharpInstance = sharpInstance.png({ compressionLevel: 6 });
                    break;
                case "webp":
                    sharpInstance = sharpInstance.webp({ quality: 90 });
                    break;
                case "gif":
                    sharpInstance = sharpInstance.gif();
                    break;
            }

            const outputBuffer = await sharpInstance.toBuffer();
            const result = `data:${targetMime};base64,${outputBuffer.toString("base64")}`;

            // Cache (cap at 50 entries to avoid memory leak)
            if (this.convertCache.size >= 50) {
                const firstKey = this.convertCache.keys().next().value;
                if (firstKey) this.convertCache.delete(firstKey);
            }
            this.convertCache.set(cacheKey, result);

            logger.debug(`Converted image: ${sourceMime} → ${targetMime}`);
            return result;
        } catch (error) {
            logger.warn(`Image conversion failed (${sourceMime} → ${targetFormat}): ${error}, returning original`);
            return dataUri;
        }
    }

    private makeFileId(): string {
        return `file_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
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

}

export function getFileService(): FileService {
    return FileService.getInstance();
}
