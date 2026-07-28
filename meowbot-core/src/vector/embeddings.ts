/**
 * Embedding service — uses remote Ollama or LM Studio API.
 *
 * Ollama:    POST /api/embed  { model, input }
 * LM Studio: POST /v1/embeddings  { model, input }
 *
 * Auto-detects embedding dimension from first API call.
 * Local filesystem cache avoids redundant API calls.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("Embeddings");

export type EmbeddingVector = number[];

interface CacheEntry { hash: string; vector: EmbeddingVector; }
interface CacheFile { version: 1; entries: Record<string, CacheEntry>; }

// ── Config ──

export interface EmbdConfig {
    enabled: boolean;
    type: "ollama" | "lmstudio";
    url: string;
    model: string;
}

function loadConfig(): EmbdConfig {
    // Env vars override config.json
    const enabled = process.env.EMBEDDING_ENABLED
        ? process.env.EMBEDDING_ENABLED === "true"
        : undefined;
    const type = (process.env.EMBEDDING_TYPE as "ollama" | "lmstudio") || undefined;
    const url = process.env.EMBEDDING_URL || undefined;
    const model = process.env.EMBEDDING_MODEL || undefined;

    try {
        const configPath = resolve(import.meta.dirname, "..", "..", "config", "config.json");
        if (!existsSync(configPath)) {
            return {
                enabled: enabled ?? false, type: type ?? "ollama",
                url: url ?? "http://127.0.0.1:11434", model: model ?? "gemma-embedding",
            };
        }
        const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
        const embd = cfg?.embd ?? {};
        return {
            enabled: enabled ?? embd?.enabled ?? false,
            type: type ?? embd?.type ?? "ollama",
            url: url ?? embd?.url ?? "http://127.0.0.1:11434",
            model: model ?? embd?.model ?? "gemma-embedding",
        };
    } catch {
            return { enabled: enabled ?? false, type: type ?? "ollama", url: url ?? "http://127.0.0.1:11434", model: model ?? "gemma-embedding" };
    }
}

const EMBEDDING_DIM_FALLBACK = 768;
const CACHE_DIR = resolve(import.meta.dirname, "..", "..", "cache", "vector-embeddings");
const CACHE_FILE = resolve(CACHE_DIR, "embeddings-cache.json");
const DIM_CACHE_FILE = resolve(CACHE_DIR, "embedding-dim.json");

export class EmbeddingService {
    private static instance: EmbeddingService;
    private config: EmbdConfig;
    private detectedDim: number | null = null;
    private cache: Map<string, number[]> = new Map();
    private dirty = false;

    private constructor() { this.config = loadConfig(); }

    static getInstance(): EmbeddingService { return EmbeddingService.instance ??= new EmbeddingService(); }
    get isEnabled(): boolean { return this.config.enabled; }
    reloadConfig(): void { this.config = loadConfig(); }

    private hash(text: string): string {
        let h = 0; for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
        return String(h >>> 0);
    }

    private async loadCache(): Promise<void> {
        try {
            if (!existsSync(CACHE_FILE)) return;
            const raw = await readFile(CACHE_FILE, "utf-8");
            const data: CacheFile = JSON.parse(raw);
            for (const [key, entry] of Object.entries(data.entries)) this.cache.set(key, entry.vector);
            logger.debug(`Loaded ${this.cache.size} cached embeddings`);
        } catch { /* fresh */ }
    }

    async flush(): Promise<void> {
        if (!this.dirty) return;
        await mkdir(CACHE_DIR, { recursive: true });
        const entries: Record<string, CacheEntry> = {};
        for (const [key, vector] of this.cache) entries[key] = { hash: key, vector };
        await writeFile(CACHE_FILE, JSON.stringify({ version: 1, entries }), "utf-8");
        this.dirty = false;
    }

    private async apiEmbed(texts: string[]): Promise<number[][]> {
        const { type, url, model } = this.config;
        const start = Date.now();
        const preview = texts.map(t => t.length > 80 ? t.slice(0, 80) + "..." : t).join(" | ");
        logger.trace(`Embedding via ${type}/${model}: "${preview}"`);

        if (type === "ollama") {
            const resp = await fetch(`${url}/api/embed`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model, input: texts }),
            });
            if (!resp.ok) throw new Error(`Ollama embed ${resp.status}: ${await resp.text()}`);
            const data = await resp.json() as { embeddings: number[][] };
            logger.info(`Embedded ${texts.length} text(s) in ${Date.now() - start}ms (${data.embeddings[0]?.length ?? "?"}dim)`);
            return data.embeddings;
        }
        // LM Studio (OpenAI-compatible)
        const resp = await fetch(`${url}/v1/embeddings`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, input: texts }),
        });
        if (!resp.ok) throw new Error(`LM Studio embed ${resp.status}: ${await resp.text()}`);
        const data = await resp.json() as { data: Array<{ embedding: number[] }> };
        logger.info(`Embedded ${texts.length} text(s) in ${Date.now() - start}ms (${data.data[0]?.embedding?.length ?? "?"}dim)`);
        return data.data.map(d => d.embedding);
    }

    private async detectDimension(): Promise<number> {
        if (this.detectedDim !== null) return this.detectedDim;

        // Try cached dimension first
        try {
            if (existsSync(DIM_CACHE_FILE)) {
                const cached = JSON.parse(readFileSync(DIM_CACHE_FILE, "utf-8"));
                if (cached.dim && cached.model === this.config.model) {
                    this.detectedDim = cached.dim as number;
                    logger.info(`Embedding dim from cache: ${this.detectedDim}`);
                    return this.detectedDim;
                }
            }
        } catch { /* stale */ }

        // Probe the API
        try {
            const vecs = await this.apiEmbed(["dimension probe"]);
            this.detectedDim = vecs[0].length;
            await mkdir(CACHE_DIR, { recursive: true });
            await writeFile(DIM_CACHE_FILE, JSON.stringify({ model: this.config.model, dim: this.detectedDim }), "utf-8");
            logger.info(`Embedding dim detected: ${this.detectedDim}`);
        } catch (error) {
            logger.warn(`Dim detect failed, fallback ${EMBEDDING_DIM_FALLBACK}: ${error}`);
            this.detectedDim = EMBEDDING_DIM_FALLBACK;
        }
        return this.detectedDim;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        if (!text?.trim()) {
            const dim = this.detectedDim ?? EMBEDDING_DIM_FALLBACK;
            return new Array(dim).fill(0);
        }
        const key = this.hash(text.trim());
        const cached = this.cache.get(key);
        if (cached) return cached;
        if (this.cache.size === 0) await this.loadCache();
        await this.detectDimension();
        const vecs = await this.apiEmbed([text.trim()]);
        this.cache.set(key, vecs[0]);
        this.dirty = true;
        return vecs[0];
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const results: EmbeddingVector[] = [];
        for (const text of texts) results.push(await this.embed(text));
        return results;
    }

    get cacheSize(): number { return this.cache.size; }
}
