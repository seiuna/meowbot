/**
 * Loads .md template files from a directory.
 * Each file can have an optional YAML frontmatter header:
 *
 *   ---
 *   name: my-template
 *   ---
 *   Content with ${variables}
 *
 * If no `name` is in frontmatter, the filename (lowercase, _ removed, no .md) is used.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve, extname, basename } from "node:path";
import { renderTemplate } from "./engine.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("TemplateLoader");

export interface LoadedTemplate {
    name: string;
    content: string;
    description: string;
    requiredProviders: string[];
}

/**
 * Parse frontmatter from markdown content.
 * Supports `---` delimited YAML-like key: value pairs.
 * Handles both \n and \r\n line endings.
 * Also supports comma-separated lists for array fields.
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
    const meta: Record<string, string> = {};
    let body = raw;
    const normalized = raw.replace(/\r\n/g, "\n");

    if (normalized.startsWith("---\n")) {
        const endIdx = normalized.indexOf("\n---\n", 4);
        if (endIdx !== -1) {
            const header = normalized.slice(4, endIdx);
            body = normalized.slice(endIdx + 5).trim();

            for (const line of header.split("\n")) {
                const colonIdx = line.indexOf(":");
                if (colonIdx > 0) {
                    const key = line.slice(0, colonIdx).trim();
                    const value = line.slice(colonIdx + 1).trim();
                    meta[key] = value;
                }
            }
        }
    }

    return { meta, body };
}

/**
 * Validate that specified tool providers exist.
 * Logs a warning for any missing provider.
 */
function validateProviders(name: string, providers: string[], available: string[]): void {
    for (const p of providers) {
        if (!available.includes(p)) {
            logger.warn(`Template "${name}" requires provider "${p}" which is NOT registered`);
        }
    }
}

/**
 * Derive a template name from filename.
 * e.g. "SKILL_EMAIL.md" → "skillemail"
 */
function deriveName(filename: string): string {
    const base = basename(filename, extname(filename));
    return base.toLowerCase().replace(/_/g, "");
}

/**
 * Load all .md files from a directory, parse frontmatter, and return templates.
 */
export async function loadTemplates(
    dirPath: string,
    availableProviders?: string[],
): Promise<Map<string, LoadedTemplate>> {
    const templates = new Map<string, LoadedTemplate>();
    const absDir = resolve(dirPath);

    let entries: string[];
    try {
        entries = await readdir(absDir);
    } catch {
        logger.info("Template directory not found: " + absDir);
        return templates;
    }

    for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;

        const filePath = join(absDir, entry);
        const raw = await readFile(filePath, "utf-8");
        const { meta, body } = parseFrontmatter(raw);

        const name = meta.name || deriveName(entry);
        const description = meta.description || "";
        const requiredProviders = meta["required-providers"] || meta.requiredProviders || "";
        const providers = requiredProviders
            ? requiredProviders.split(",").map(s => s.trim()).filter(Boolean)
            : [];

        if (providers.length > 0 && availableProviders) {
            validateProviders(name, providers, availableProviders);
        }

        templates.set(name, { name, content: body, description, requiredProviders: providers });
        logger.debug("Loaded template \"" + name + "\" from " + entry +
            (description ? " desc=\"" + description.substring(0, 40) + "\"" : ""));
    }

    logger.info("Loaded " + templates.size + " template(s) from " + absDir);
    return templates;
}

/**
 * Build a rendered string from a named template.
 */
export function buildTemplate(
    templates: Map<string, LoadedTemplate>,
    name: string,
    data: Record<string, any>
): string {
    const tpl = templates.get(name);
    if (!tpl) {
        logger.warn(`Template "${name}" not found`);
        return "";
    }
    return renderTemplate(tpl.content, data);
}
