import puppeteer, {Browser, BrowserContext, Page} from "puppeteer";
import art from "art-template";
import {getLogger} from "@meowbot/utils/logs";
import type {ScreenshotSource, ScreenshotOptions, OutputType} from "./index.js";
import { AppServer } from "@meowbot/server/index.js";

const logger = getLogger("ImageGen");

const MAX_PAGES_LIMIT = 50;

// Default viewport for screenshot pages (width × height).
const DEFAULT_VIEWPORT = { width: 1080, height: 1920 };

// Headless mode: can be overridden via HEADLESS=false for debugging.
const IS_HEADLESS = process.env.HEADLESS !== "false";

// ── Internal capture options ──

export interface CaptureOptions {
    name: string;
    elementId: string;
    headers?: Record<string, string>;
    data: unknown;
    /** If true, the page is already loaded — skip goto, push data via __RENDER_PAGE__. */
    reload?: boolean;
}

// ── Timing helper ──

/** Lightweight stopwatch for a single phase. */
class Stopwatch {
    private start = Date.now();
    elapsed(): number {
        return Date.now() - this.start;
    }
    reset(): void {
        this.start = Date.now();
    }
}

/**
 * Owns the Puppeteer browser instance and exposes capture methods.
 *
 * Each page lives in its own isolated BrowserContext (separate window)
 * so it is always the single active tab — no background-tab throttling.
 */
export class ScreenshotManager {
    private browser: Browser | null = null;
    private allPages: Page[] = [];
    private contexts: BrowserContext[] = [];
    private initPromise: Promise<void> | null = null;
    private static instance: ScreenshotManager | null = null;
    private static instancePromise: Promise<ScreenshotManager> | null = null;

    // ── Browser lifecycle ──
    static async getInstance(): Promise<ScreenshotManager> {
        if (ScreenshotManager.instance) return ScreenshotManager.instance;
        if (!ScreenshotManager.instancePromise) {
            ScreenshotManager.instancePromise = (async () => {
                const instance = new ScreenshotManager();
                await instance.init();
                ScreenshotManager.instance = instance;
                ScreenshotManager.instancePromise = null;
                return instance;
            })();
        }
        return ScreenshotManager.instancePromise;
    }
    async init(): Promise<void> {
        if (this.browser) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                this.browser = await puppeteer.launch({
                    headless: IS_HEADLESS,
                    protocolTimeout: 600_000,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-extensions",
                    ],
                });
                // Auto-track closed pages via browser-level target destruction
                this.browser.on("targetdestroyed", () => {
                    this.purgeClosedPages();
                });
                logger.info("Puppeteer browser launched");
            } catch (err) {
                this.initPromise = null;
                throw err;
            }
        })();

        return this.initPromise;
    }

    /** Remove closed pages from tracking arrays. */
    private purgeClosedPages(): void {
        this.allPages = this.allPages.filter(p => !p.isClosed());
    }

    /**
     * Create a fresh page in its own isolated browser context.
     * Each context is a separate window with a single active tab —
     * Chrome never throttles it, so screenshots are instant.
     */
    async createPage(): Promise<Page> {
        if (!this.browser) throw new Error("Browser not initialised — call init() first");

        this.purgeClosedPages();
        if (this.allPages.length >= MAX_PAGES_LIMIT) {
            throw new Error(`Page limit reached (${MAX_PAGES_LIMIT}). Close existing pages before creating new ones.`);
        }

        const context = await this.browser.createBrowserContext();
        this.contexts.push(context);
        const page = await context.newPage();
        await page.setViewport(DEFAULT_VIEWPORT);
        this.allPages.push(page);
        return page;
    }

    // ── Capture: URL / Template ──

    async capture(page: Page, source: ScreenshotSource, opts: CaptureOptions): Promise<Uint8Array> {
        const tag = opts.name;
        const t0 = Date.now();

        try {
            // 1. Headers
            let tHeaders = 0;
            if (opts.headers) {
                const sw = new Stopwatch();
                await page.setExtraHTTPHeaders(opts.headers);
                tHeaders = sw.elapsed();
            }

            // 2. Load content
            let tRender = 0;
            let tGoto = 0;
            let tWaitFn = 0;
            let fullUrl = "";

            if (source._tag === "template") {
                const sw = new Stopwatch();
                const html = art.render(source.raw, opts.data as Record<string, unknown> ?? {});
                const tTplRender = sw.elapsed();
                const sw2 = new Stopwatch();
                await page.setContent(html, {waitUntil: "load"});
                const tSetContent = sw2.elapsed();
                tRender = tTplRender + tSetContent;
                logger.info(`[${tag}] ┝ template: render=${tTplRender}ms setContent=${tSetContent}ms`);
            } else if (!opts.reload) {
                const server = AppServer.getInstance();
                const key = await server.storeGenerationData(opts.data);
                fullUrl = source.value.includes("?")
                    ? `${source.value}&key=${encodeURIComponent(key)}`
                    : `${source.value}?key=${encodeURIComponent(key)}`;
            }

            if (source._tag === "url") {
                if (opts.reload) {
                    // ── Network reload: store data, then tell page to re-fetch ──
                    const server = AppServer.getInstance();
                    const newKey = await server.storeGenerationData(opts.data);

                    const sw = new Stopwatch();
                    await page.evaluate(async (k: string) => {
                        (window as any).__VUE_RENDERED__ = false;
                        if (typeof (window as any).__RENDER_PAGE__ !== "function") {
                            throw new Error("__RENDER_PAGE__ is not defined on the page");
                        }
                        await (window as any).__RENDER_PAGE__(k);
                    }, newKey);
                    tRender = sw.elapsed();

                    const sw2 = new Stopwatch();
                    await page.waitForFunction(() => {
                        if (typeof (window as any).__VUE_RENDERED__ !== "undefined") {
                            return (window as any).__VUE_RENDERED__ === true;
                        }
                        return document.readyState === "complete";
                    }, {timeout: 15_000, polling: 10});
                    tWaitFn = sw2.elapsed();

                    logger.info(`[${tag}] ┝ URL reload (network): render=${tRender}ms waitFn=${tWaitFn}ms`);
                } else {
                    // ── First load: page fetches data from API using ?key= ──
                    const sw = new Stopwatch();
                    await page.goto(fullUrl, {waitUntil: "domcontentloaded", timeout: 30_000});
                    tGoto = sw.elapsed();

                    const sw3 = new Stopwatch();
                    await page.waitForFunction(() => {
                        if (typeof (window as any).__VUE_RENDERED__ !== "undefined") {
                            return (window as any).__VUE_RENDERED__ === true;
                        }
                        return document.readyState === "complete";
                    }, {timeout: 15_000, polling: 10});
                    tWaitFn = sw3.elapsed();

                    logger.info(`[${tag}] ┝ URL (network): goto=${tGoto}ms waitFn=${tWaitFn}ms`);
                }
            }

            {
                const sw = new Stopwatch();
                await page.waitForFunction((sel: string) => {
                    // Align fallback with clip logic: when no selector given or
                    // element not found, wait for all images across the body.
                    const el = (sel ? document.querySelector(sel) : null) || document.body;
                    const imgs = el.querySelectorAll("img");
                    return Array.from(imgs).every(
                        img => img.complete && img.naturalWidth > 0,
                    );
                }, {timeout: 10_000, polling: 100}, opts.elementId).catch(() => {
                    logger.warn(`[${tag}] Some images may not have loaded within timeout`);
                });
                const tImgWait = sw.elapsed();
                if (tImgWait > 50) {
                    logger.info(`[${tag}] ┝ images waited: ${tImgWait}ms`);
                }
            }

            // 4. Get clip coordinates — instant evaluate, no ElementHandle overhead
            const sw = new Stopwatch();
            const clip = await page.evaluate((sel: string) => {
                const el = document.querySelector(sel) || document.body;
                el.scrollIntoView({behavior: "instant", block: "center"});
                const r = el.getBoundingClientRect();
                return {
                    x: r.left + window.scrollX,
                    y: r.top + window.scrollY,
                    width: r.width || 100,
                    height: r.height || 100,
                };
            }, opts.elementId);
            const tClip = sw.elapsed();

            // 5. Screenshot — page-level clip, avoids ElementHandle.screenshot() overhead
            const sw2 = new Stopwatch();
            const uint8 = await page.screenshot({type: "png", clip, omitBackground: true});
            const tScreenshot = sw2.elapsed();

            // 6. Log summary
            const total = Date.now() - t0;
            const sizeKB = (uint8.length / 1024).toFixed(1);
            const Y = "\x1b[33m";
            const R = "\x1b[0m";
            logger.info(
                `[${tag}] ${sizeKB}KB ${Y}+${total}ms${R} ` +
                `(headers=${tHeaders}ms ` +
                `${source._tag === "template" ? `render=${tRender}ms` : `goto=${tGoto}ms waitFn=${tWaitFn}ms`} ` +
                `clip=${tClip}ms screenshot=${tScreenshot}ms)` +
                ` element=${opts.elementId}`,
            );

            return uint8;
        } catch (err) {
            logger.warn(
                `[${tag}] Capture failed: ${(err as Error).message} — falling back to viewport screenshot`,
            );
            const rt = await page.screenshot({type: "png", omitBackground: true}).catch(() => new Uint8Array());
            const idx = this.allPages.indexOf(page);
            if (idx !== -1) this.allPages.splice(idx, 1);
            await page.close().catch(() => {});
            return rt;
        }
    }

    // ── Task factory ──

    async createTask<T>(options: ScreenshotOptions): Promise<import("./screenshot-task.js").ScreenshotTask<T>> {
        const {ScreenshotTask} = await import("./screenshot-task.js");
        options.elementId = options.elementId ?? `#screenshot-target`;
        return new ScreenshotTask<T>(options, this);
    }

    async execute<T>(
        options: ScreenshotOptions,
        data: T,
        type: OutputType = "base64",
    ): Promise<string> {
        const task = await this.createTask<T>(options);
        try {
            return await task.generate(data, type);
        } finally {
            await task.destroy();
        }
    }

    // ── Teardown ──

    async destroy(): Promise<void> {
        for (const page of this.allPages) {
            await page.close().catch(() => {});
        }
        this.allPages = [];

        for (const ctx of this.contexts) {
            await ctx.close().catch(() => {});
        }
        this.contexts = [];

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            logger.info("Puppeteer browser closed");
        }
    }
}
