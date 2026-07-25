import {Semaphore} from "async-mutex";
import type {Page} from "puppeteer";
import {getLogger} from "@meowbot/utils/logs";
import {CacheManager} from "./cache.js";
import {ScreenshotManager} from "./screenshot-manager.js";
import type {ScreenshotSource, OutputType, ScreenshotOptions} from "./index.js";

const logger = getLogger("ImageGen:Task");

// ── Helpers ──

/** Determine how many concurrent pages a source type should use. */
function resolveMaxPages(source: ScreenshotSource): number {
    switch (source._tag) {
        case "template":
            return 1;
        case "url":
            return 2;
    }
}

/**
 * Refactored task that generates a screenshot for a specific source + data
 * combination, using async-mutex primitives for race-free concurrency.
 *
 * **Key changes from the original:**
 * - Constructor receives {@link ScreenshotManager} directly (no `_bind()`).
 * - Page-pool concurrency is governed by a {@link Semaphore}.
 * - Slot-mode shared-page initialisation is protected by a {@link Mutex}.
 * - Cache concerns are delegated to {@link CacheManager}.
 */
export class ScreenshotTask<T = any> {
    private name: string;
    private source: ScreenshotSource;
    private elementId: string;
    private enableCache: boolean;
    private extraHeaders?: Record<string, string>;

    private manager: ScreenshotManager;
    private cache: CacheManager;

    // ── Page pool (URL / Template) ──
    private readonly maxPages: number;
    private readonly pageSemaphore: Semaphore;
    private idlePages: Page[] = [];
    /** Pages that have already been navigated to the source URL. */
    private loadedPages = new Set<Page>();
    /** LRU tracking: last-acquired timestamp per page (ms since epoch). */
    private pageLastUsed = new Map<Page, number>();
    /** 5-minute interval that evicts the 3 least-recently-used idle pages. */
    private lruTimer: ReturnType<typeof setInterval> | null = null;
    /** Pages currently in use (acquired but not released). */
    private activePages = new Set<Page>();
    private isDestroyed = false;

    constructor(options: ScreenshotOptions, manager: ScreenshotManager, cache?: CacheManager) {
        this.name = options.name;
        this.source = options.source;
        this.elementId = options.elementId ?? "#screenshot-target";
        this.enableCache = options.enableCache ?? true;
        this.extraHeaders = options.headers;

        this.manager = manager;
        this.cache = cache ?? new CacheManager();

        this.maxPages = resolveMaxPages(options.source);
        this.pageSemaphore = new Semaphore(this.maxPages);

        // ── LRU eviction timer: close the 3 least-recently-used idle pages
        //     every 5 minutes to keep memory usage bounded.
        this.lruTimer = setInterval(() => this.evictLRU(), 5 * 60 * 1000);
        if (this.lruTimer.unref) this.lruTimer.unref(); // don't keep process alive
    }

    // ── LRU eviction ──

    /** Close the 3 least-recently-used idle pages, keeping at least maxPages. */
    private async evictLRU(): Promise<void> {
        if (this.idlePages.length <= this.maxPages) return;

        // Filter out any pages that are currently in use
        const idleOnly = this.idlePages.filter(p => !this.activePages.has(p));
        if (idleOnly.length <= this.maxPages) return;

        // Sort idle pages by last-used timestamp (oldest first)
        const sorted = [...idleOnly].sort(
            (a, b) => (this.pageLastUsed.get(a) ?? 0) - (this.pageLastUsed.get(b) ?? 0),
        );
        const toEvict = sorted.slice(0, 3);

        for (const page of toEvict) {
            const idx = this.idlePages.indexOf(page);
            if (idx !== -1) this.idlePages.splice(idx, 1);
            this.loadedPages.delete(page);
            this.pageLastUsed.delete(page);
            await page.close().catch(() => {});
        }

        if (toEvict.length > 0) {
            logger.info(
                `[${this.name}] LRU evicted ${toEvict.length} idle page(s), ` +
                `${this.idlePages.length} remaining`,
            );
        }
    }

    /** Record a page access for LRU tracking. */
    private touchPage(page: Page): void {
        this.pageLastUsed.set(page, Date.now());
    }

    // ── Public API ──

    /** Stable payload for the cache hash: source content + serialized data. */
    private cachePayload(data: T): string {
        const base = this.source._tag === "template"
            ? this.source.raw
            : this.source.value;
        return base + JSON.stringify(data ?? {});
    }

    private key(data: T): string {
        return this.cache.key(this.name, this.cachePayload(data));
    }

    async hasCache(data: T): Promise<boolean> {
        if (!this.enableCache) return false;
        return this.cache.has(this.key(data));
    }

    /**
     * Generate a screenshot.
     *
     * - URL sources: data injected via server-side store.
     * - Template sources: data rendered into template HTML.
     * - Slot sources: data injected via JS without page navigation.
     */
    async generate(data: T, type: OutputType): Promise<string> {
        const key = this.key(data);

        if (this.enableCache) {
            const cached = await this.cache.read(key);
            if (cached) {
                logger.info(`[${this.name}] cache hit`);
                return type === "base64"
                    ? `data:image/png;base64,${cached.toString("base64")}`
                    : this.cache.path(key);
            }
        }

        // ── Capture ──
        const uint8 = await this.captureViaPage(data);

        if (this.enableCache) {
            await this.cache.write(key, uint8);
        }

        if (type === "base64") {
            return `data:image/png;base64,${CacheManager.bufferFromUint8(uint8).toString("base64")}`;
        }
        // File output — the cache write above already persisted it (or we write now if cache disabled)
        if (!this.enableCache) {
            await this.cache.write(key, uint8);
        }
        return this.cache.path(key);
    }

    // ── Page-pool capture (URL / Template) ──

    private async captureViaPage(data: T): Promise<Uint8Array> {
        let page: Page | null = null;
        let semaphoreHeld = false;
        let pageAcquired = false;
        try {
            page = await this.acquirePage();
            semaphoreHeld = true;
            pageAcquired = true;
            this.activePages.add(page);
            const alreadyLoaded = this.loadedPages.has(page);
            const result = await this.manager.capture(page, this.source, {
                name: this.name,
                elementId: this.elementId,
                headers: this.extraHeaders,
                data,
                reload: alreadyLoaded,
            });
            if (!alreadyLoaded) {
                this.loadedPages.add(page);
            }
            return result;
        } finally {
            if (page) {
                this.activePages.delete(page);
                if (page.isClosed()) {
                    this.loadedPages.delete(page);
                }
            }
            if (semaphoreHeld) {
                if (page && !page.isClosed()) {
                    this.idlePages.push(page);
                    this.touchPage(page);
                }
                this.pageSemaphore.release();
            }
        }
    }

    // ── Page pool operations (Semaphore-governed) ──

    /**
     * Acquire an idle page.
     *
     * The Semaphore ensures we never exceed {@code maxPages} concurrent
     * acquisitions.  Once we hold a permit we either reuse an idle page
     * or create a new one.
     */
    private async acquirePage(): Promise<Page> {
        await this.pageSemaphore.acquire();

        try {
            // Purge any closed pages that accumulated in the idle pool
            for (const p of this.idlePages) {
                if (p.isClosed()) this.loadedPages.delete(p);
            }
            this.idlePages = this.idlePages.filter(p => !p.isClosed());

            if (this.idlePages.length > 0) {
                const page = this.idlePages.pop()!;
                this.touchPage(page);
                return page;
            }

            // Under the semaphore permit — safe to create
            const page = await this.manager.createPage();
            this.touchPage(page);
            return page;
        } catch (err) {
            // Release the permit on failure so the semaphore doesn't leak
            this.pageSemaphore.release();
            throw err;
        }
    }

    /** Expose a live page for external inspection (e.g. tests).
     *  If the existing page has been closed, a fresh one is created. */
    async getPage(): Promise<Page | null> {
        // Purge dead pages from the idle pool, then return (or create) a live one
        this.idlePages = this.idlePages.filter(p => !p.isClosed());
        if (this.idlePages.length > 0) return this.idlePages[0];
        const page = await this.manager.createPage();
        this.idlePages.push(page);
        this.touchPage(page);
        return page;
    }

    // ── Teardown ──

    /** Close all pages owned by this task and release semaphore waiters. */
    async destroy(): Promise<void> {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        // Stop LRU eviction timer
        if (this.lruTimer) {
            clearInterval(this.lruTimer);
            this.lruTimer = null;
        }

        // Drain semaphores so pending waiters reject cleanly
        this.pageSemaphore.cancel();

        for (const page of this.idlePages) {
            await page.close().catch(() => {});
        }
        this.idlePages = [];
        this.loadedPages.clear();
        this.pageLastUsed.clear();
        this.activePages.clear();
    }
}
