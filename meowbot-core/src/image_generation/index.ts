import { AppServer } from "@meowbot/server/index.js";
import fs from "node:fs";
import path from "node:path";

// ── Re-exports ──

export {CacheManager} from "./cache.js";
export {ScreenshotManager} from "./screenshot-manager.js";
export type {CaptureOptions} from "./screenshot-manager.js";
export {ScreenshotTask} from "./screenshot-task.js";
// ── Types ──

export type OutputType = "base64" | "file";

export interface ClipRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

// ── ScreenshotSource ──

type SourceUrl = {_tag: "url"; value: string};
type SourceTemplate = {_tag: "template"; raw: string};

export type ScreenshotSource = SourceUrl | SourceTemplate;

export const BuilderSource = {
    /**
     * Standard URL source. Data is injected via server-side store and
     * accessed by the page through a global variable. Best for complex
     * pages and separated frontend/backend scenarios.
     */
    fromUrl(url: string): ScreenshotSource {
        return {_tag: "url", value: url};
    },

    /**
     * Official URL source that automatically selects the base URL
     * based on the environment:
     * - Dev mode: http://localhost:5173/generation/
     * - Production: AppServer's base URL + /generation/
     *
     * @param pagePath  The path to append to the base URL (e.g., "github-card")
     */
    fromOfficialUrl(pagePath: string): ScreenshotSource {
        const url = `${AppServer.getInstance().generationBaseUrl}/generation/${pagePath}`;
        return {_tag: "url", value: url};
    },

    /**
     * Load a template file from {@code data/art-template/}.
     * Data is rendered into the template HTML at generation time.
     */
    fromTemplate(name: string): ScreenshotSource {
        return {_tag: "template", raw: loadTemplate(name)};
    },
};

// ── ScreenshotOptions ──

export interface ScreenshotOptions {
    /** Unique name for this task — used in the cache key. */
    name: string;
    source: ScreenshotSource;
    elementId?: string;
    enableCache?: boolean;
    headers?: Record<string, string>;
}

// ── Template helpers ──

const TEMPLATE_DIR = path.resolve("data", "art-template");

function loadTemplate(name: string): string {
    const filePath = path.join(TEMPLATE_DIR, name);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Template not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf-8");
}
