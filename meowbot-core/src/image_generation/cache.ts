import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {getLogger} from "@meowbot/utils/logs";

const logger = getLogger("ImageGen:Cache");

const CACHE_DIR = path.resolve(process.cwd(), "cache", "screenshots");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface CacheMetadata {
    createdAt: number;
    ttl: number;
}

/**
 * Standalone cache layer for screenshot outputs.
 *
 * Encapsulates file-system operations (hash, read, write, existence check)
 * that were previously scattered across top-level functions in index.ts.
 *
 * Features:
 * - Async file I/O to avoid blocking the event loop
 * - TTL-based cache expiration
 * - Automatic periodic cleanup
 */
export class CacheManager {
    private readonly cacheDir: string;
    private readonly ttlMs: number;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;
    private metadata = new Map<string, CacheMetadata>();

    constructor(cacheDir: string = CACHE_DIR, ttlMs: number = DEFAULT_TTL_MS) {
        this.cacheDir = cacheDir;
        this.ttlMs = ttlMs;
        this.startCleanupTimer();
    }

    private startCleanupTimer(): void {
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
        if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    /** Ensure the cache directory exists on disk. */
    async ensureDir(): Promise<void> {
        try {
            await fs.access(this.cacheDir);
        } catch {
            await fs.mkdir(this.cacheDir, {recursive: true});
        }
    }

    /** Build a cache key: {@code name}_{MD5(payload)}. */
    key(name: string, payload: string): string {
        const hash = crypto.createHash("md5").update(payload).digest("hex");
        return `${name}_${hash}`;
    }

    /** Absolute path for the given cache key. */
    path(key: string): string {
        return path.join(this.cacheDir, `${key}.png`);
    }

    /** Check if a cache entry is expired. */
    private isExpired(key: string): boolean {
        const meta = this.metadata.get(key);
        if (!meta) return false;
        return Date.now() - meta.createdAt > meta.ttl;
    }

    /** Read cached Buffer, or null on miss. */
    async read(key: string): Promise<Buffer | null> {
        if (this.isExpired(key)) {
            this.metadata.delete(key);
            await fs.unlink(this.path(key)).catch(() => {});
            return null;
        }

        const p = this.path(key);
        try {
            const data = await fs.readFile(p);
            logger.trace(`Cache hit: ${key}`);
            return data;
        } catch {
            return null;
        }
    }

    /** Write PNG data to the cache. */
    async write(key: string, data: Uint8Array): Promise<void> {
        await this.ensureDir();
        await fs.writeFile(this.path(key), data);
        this.metadata.set(key, {createdAt: Date.now(), ttl: this.ttlMs});
        logger.trace(`Cache write: ${key}`);
    }

    /** Check whether a cache entry exists and is not expired. */
    async has(key: string): Promise<boolean> {
        if (this.isExpired(key)) {
            this.metadata.delete(key);
            await fs.unlink(this.path(key)).catch(() => {});
            return false;
        }

        try {
            await fs.access(this.path(key));
            return true;
        } catch {
            return false;
        }
    }

    /** Remove expired cache entries. */
    async cleanup(): Promise<void> {
        try {
            const files = await fs.readdir(this.cacheDir);
            let cleaned = 0;

            for (const file of files) {
                if (!file.endsWith('.png')) continue;
                const key = file.replace('.png', '');
                if (this.isExpired(key)) {
                    await fs.unlink(path.join(this.cacheDir, file)).catch(() => {});
                    this.metadata.delete(key);
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                logger.info(`Cache cleanup: removed ${cleaned} expired entries`);
            }
        } catch (err) {
            logger.warn(`Cache cleanup failed: ${(err as Error).message}`);
        }
    }

    /** Stop the cleanup timer. */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /** Helper: convert Uint8Array to Node Buffer. */
    static bufferFromUint8(uint8: Uint8Array): Buffer {
        return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    }
}
