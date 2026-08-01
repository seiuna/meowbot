/**
 * FileSystem tool provider — standard read/write/list/search tools that operate
 * on absolute paths anywhere on this computer.
 *
 * Every handler first runs the path through {@link FsAccessControl} (blacklist
 * + optional whitelist), so denied paths are rejected before any I/O happens.
 *
 * Tool-level permissions: read/list/search require `fs.read`, write requires
 * `fs.write` (granted via `/perm user <id> add fs.read`, ...).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { defineEnvToolWithThought as defineTool } from "@meowbot/tools/tools";
import { IToolProvider } from "@meowbot/tools/tool_registry";
import { getFsAccessControl } from "./access_control.js";
import { globToRegex } from "../../utils/glob.js";
import { getLogger } from "../../utils/logs.js";

const logger = getLogger("FileSystemTools");

const MAX_READ_SIZE = 10 * 1024 * 1024;
const MAX_WRITE_SIZE = 10 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 200;

const SKIP_EXTS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
    ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".avi",
    ".zip", ".tar", ".gz", ".7z", ".rar",
    ".pdf", ".docx", ".xlsx", ".pptx",
    ".woff", ".woff2", ".ttf", ".eot",
]);

function ok(data: Record<string, unknown>): string {
    return JSON.stringify({ ok: true, ...data });
}

function fail(message: string): string {
    return JSON.stringify({ ok: false, error: message });
}

const READ_PERMS = { perms: ["fs.read"] };
const WRITE_PERMS = { perms: ["fs.write"] };

// ── list_directory ──

const listDirectoryTool = defineTool(
    {
        name: "list_directory",
        description:
            "List the immediate children of an absolute directory path on this computer. " +
            "Directories are listed first, then files, alphabetically. " +
            "Entries blocked by the filesystem access policy (blacklist/whitelist) are omitted. " +
            "Use absolute paths like 'E:/project' or 'C:/Users/...'.",
        schema: z.object({
            path: z.string().describe("Absolute directory path to list"),
        }),
    },
    async ({ path: dirPath }) => {
        try {
            const access = getFsAccessControl();
            const verified = await access.verify(dirPath);
            if (!verified.ok) return fail(verified.error);

            const dirents = await fs.readdir(verified.path, { withFileTypes: true });
            const listed = dirents.map(e => ({
                name: e.name,
                type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
                path: path.join(verified.path, e.name),
            }));
            const allowed = access.filterEntries(listed);
            allowed.sort((a, b) =>
                a.type === b.type
                    ? a.name.localeCompare(b.name)
                    : a.type === "dir"
                        ? -1
                        : 1,
            );

            return ok({
                path: verified.path,
                entries: allowed,
                filtered_count: listed.length - allowed.length,
            });
        } catch (error: any) {
            logger.error(`list_directory failed for ${dirPath}: ${error}`);
            return fail("Failed to list directory: " + error.message);
        }
    },
    READ_PERMS,
);

// ── read_file ──

const readFileTool = defineTool(
    {
        name: "read_file",
        description:
            "Read a text file from an absolute path on this computer. " +
            "Use offset/limit to read large files in chunks. " +
            "Returns total line count and the requested slice. " +
            "If the file has more lines beyond limit, a hint with the next offset is included.",
        schema: z.object({
            path: z.string().describe("Absolute path of the file to read"),
            offset: z.number().int().min(0).optional().describe("Start reading from this line (0-based, default 0)"),
            limit: z.number().int().min(1).optional().describe("Max lines to read (default: read all)"),
        }),
    },
    async ({ path: filePath, offset, limit }) => {
        try {
            const verified = await getFsAccessControl().verify(filePath);
            if (!verified.ok) return fail(verified.error);

            const stat = await fs.stat(verified.path);
            if (stat.isDirectory()) return fail(`Path is a directory, not a file: ${filePath}`);
            if (stat.size > MAX_READ_SIZE) {
                return fail(`File too large (${stat.size} bytes, max ${MAX_READ_SIZE}). Refusing to read.`);
            }

            const content = await fs.readFile(verified.path, "utf-8");
            if (content.includes("\u0000")) {
                return fail("Binary file: cannot be read as text.");
            }

            const lines = content.split("\n");
            const totalLines = lines.length;
            const start = offset ?? 0;
            const end = limit ? Math.min(start + limit, totalLines) : totalLines;

            if (start >= totalLines) {
                return fail("Offset " + start + " exceeds total lines " + totalLines);
            }

            const selected = lines.slice(start, end);
            const result: Record<string, unknown> = {
                file: verified.path,
                total_lines: totalLines,
                lines_read: (start + 1) + "-" + end,
                content: selected.join("\n"),
            };
            if (end < totalLines) {
                result.hint = "File has " + (totalLines - end) + " more lines. Use offset=" + end + " to continue reading.";
            }
            return ok(result);
        } catch (error: any) {
            logger.error(`read_file failed for ${filePath}: ${error}`);
            return fail("Failed to read file: " + error.message);
        }
    },
    READ_PERMS,
);

// ── write_file ──

const writeFileTool = defineTool(
    {
        name: "write_file",
        description:
            "Write or edit a file at an absolute path on this computer. Two modes: " +
            "1) Full write — provide 'content' (and optional 'append') to write/append the entire file. " +
            "2) Patch — provide 'edits' as [{search, replace}] to apply targeted search-and-replace " +
            "operations in order. Each search string must be found at least once. " +
            "Creates parent directories automatically. Pass either 'content' or 'edits', not both.",
        schema: z.object({
            path: z.string().describe("Absolute path of the file to write"),
            content: z.string().optional().describe(
                "Full text content to write. Use with 'append'. Mutually exclusive with 'edits'."
            ),
            append: z.boolean().default(false).describe(
                "Append mode (only with 'content'): true=add to end, false=overwrite entire file"
            ),
            edits: z.array(z.object({
                search: z.string().describe("Exact text to find and replace"),
                replace: z.string().describe("Replacement text"),
            })).min(1).optional().describe(
                "List of {search, replace} edit operations, applied in array order. " +
                "Mutually exclusive with 'content'."
            ),
        }),
    },
    async ({ path: filePath, content, append, edits }) => {
        try {
            const hasContent = content !== undefined;
            const hasEdits = edits !== undefined;
            if (hasContent === hasEdits) {
                return fail("Invalid input: pass exactly one of 'content' or 'edits'.");
            }
            if (append && !hasContent) {
                return fail("Invalid input: 'append' can only be used with 'content'.");
            }
            const verified = await getFsAccessControl().verify(filePath);
            if (!verified.ok) return fail(verified.error);
            const target = verified.path;

            if (edits && edits.length > 0) {
                let current: string;
                try {
                    current = await fs.readFile(target, "utf-8");
                } catch {
                    // File does not exist yet — create it with the first replacement.
                    if (edits.length > 0) {
                        const newContent = edits[0].replace;
                        await fs.mkdir(path.dirname(target), { recursive: true });
                        await fs.writeFile(target, newContent, "utf-8");
                        return ok({
                            file: target,
                            mode: "patch-create",
                            edits_applied: 1,
                        });
                    }
                    return fail(`File not found: ${filePath}`);
                }

                for (const edit of edits) {
                    if (!current.includes(edit.search)) {
                        return fail(`Edit failed: search string not found in ${filePath}`);
                    }
                    current = current.replaceAll(edit.search, edit.replace);
                }
                if (Buffer.byteLength(current, "utf-8") > MAX_WRITE_SIZE) {
                    return fail(`Result exceeds size limit (${MAX_WRITE_SIZE} bytes)`);
                }
                await fs.writeFile(target, current, "utf-8");
                return ok({
                    file: target,
                    mode: "patch",
                    edits_applied: edits.length,
                    size_bytes: Buffer.byteLength(current, "utf-8"),
                });
            }

            const text = content ?? "";
            if (Buffer.byteLength(text, "utf-8") > MAX_WRITE_SIZE) {
                return fail(`Content exceeds size limit (${MAX_WRITE_SIZE} bytes)`);
            }
            await fs.mkdir(path.dirname(target), { recursive: true });
            if (append) {
                await fs.appendFile(target, text, "utf-8");
            } else {
                await fs.writeFile(target, text, "utf-8");
            }
            return ok({
                file: target,
                mode: append ? "append" : "overwrite",
                size_bytes: Buffer.byteLength(text, "utf-8"),
            });
        } catch (error: any) {
            logger.error(`write_file failed for ${filePath}: ${error}`);
            return fail("Failed to write file: " + error.message);
        }
    },
    WRITE_PERMS,
);

// ── search_files ──

const searchFilesTool = defineTool(
    {
        name: "search_files",
        description:
            "Full-text search across text files under an absolute root directory. " +
            "Returns matching file paths with the line number and content of each match. " +
            "Case-insensitive substring match by default. Blacklisted subtrees are skipped. " +
            "Binary files are ignored.",
        schema: z.object({
            root: z.string().describe("Absolute directory path to search under"),
            query: z.string().describe("Search query (case-insensitive substring)"),
            glob: z.string().optional().describe("Optional glob to restrict files, e.g. '**/*.ts'"),
            max_results: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional()
                .describe("Max matches to return (default 50, cap 200)"),
        }),
    },
    async ({ root, query, glob, max_results }) => {
        try {
            const access = getFsAccessControl();
            const verified = await access.verify(root);
            if (!verified.ok) return fail(verified.error);

            const maxResults = Math.min(max_results ?? 50, MAX_SEARCH_RESULTS);
            const qLower = query.toLowerCase();
            const globRegex = glob ? globToRegex(glob, process.platform === "win32") : null;
            const results: Array<{ file: string; line: number; content: string }> = [];

            const walk = async (dir: string): Promise<void> => {
                let dirents;
                try {
                    dirents = await fs.readdir(dir, { withFileTypes: true });
                } catch {
                    return;
                }
                for (const entry of dirents) {
                    if (results.length >= maxResults) return;
                    const full = path.join(dir, entry.name);
                    if (!access.check(full).allowed) continue;
                    // Re-verify against the real path so junctions/symlinks
                    // pointing outside the allowed policy cannot be traversed.
                    const verified = await access.verify(full);
                    if (!verified.ok) continue;
                    if (entry.isDirectory()) {
                        await walk(verified.path);
                    } else if (entry.isFile()) {
                        const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
                        if (SKIP_EXTS.has(ext)) continue;
                        if (globRegex && !globRegex.test(verified.path.replace(/\\/g, "/"))) continue;
                        try {
                            const stat = await fs.stat(verified.path);
                            if (stat.size > MAX_READ_SIZE) continue;
                            const content = await fs.readFile(verified.path, "utf-8");
                            if (content.includes("\u0000")) continue;
                            const lines = content.split("\n");
                            for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                                if (lines[i].toLowerCase().includes(qLower)) {
                                    results.push({
                                        file: verified.path,
                                        line: i + 1,
                                        content: lines[i].trim().substring(0, 200),
                                    });
                                }
                            }
                        } catch {
                            // Skip unreadable files
                        }
                    }
                }
            };

            await walk(verified.path);
            return ok({
                root: verified.path,
                query,
                glob: glob ?? null,
                matches: results.length,
                truncated: results.length >= maxResults,
                results,
            });
        } catch (error: any) {
            logger.error(`search_files failed under ${root}: ${error}`);
            return fail("Failed to search files: " + error.message);
        }
    },
    READ_PERMS,
);

// ── Provider ──

export class FileSystemToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [
            listDirectoryTool,
            readFileTool,
            writeFileTool,
            searchFilesTool,
        ];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "FileSystem";
    }

    getDescription(): string {
        return "Filesystem tools — list, read, write, and search files anywhere on this computer (subject to blacklist/whitelist access control)";
    }
}
