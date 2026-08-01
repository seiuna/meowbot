import {z} from "zod";
import {DynamicStructuredTool} from "@langchain/core/tools";
import {defineEnvToolWithThought as defineTool} from "@meowbot/tools/tools";
import {IToolProvider} from "@meowbot/tools/tool_registry";
import {WorkspaceManager} from "@meowbot/workspace/workspace";
import {getLogger} from "@meowbot/utils/logs";
import {AppServer} from "../server/index.js";
import {globToRegex as sharedGlobToRegex} from "../utils/glob.js";

const logger = getLogger("WorkspaceTools");

const workspaceManager = WorkspaceManager.getInstance();

// ── Helper: consistent JSON output ──

function ok(data: Record<string, unknown>) {
    return JSON.stringify({ ok: true, ...data });
}

function fail(message: string) {
    return JSON.stringify({ ok: false, error: message });
}

/** Build a FileService fileId for a workspace file: ws/<workspaceId>/<relativePath> */
function makeFileId(workspaceId: string, filePath: string): string {
    return `ws/${workspaceId}/${filePath}`;
}

// ── Simple glob → regex converter ──

/**
 * Convert a glob pattern to a RegExp.
 * Supports: ** (any depth), * (single segment), ? (single char), {a,b} (alternation).
 */
function globToRegex(glob: string): RegExp {
    return sharedGlobToRegex(glob);
}


// ── Tools ──

const listWorkspacesTool = defineTool(
    {
        name: "list_workspaces",
        description:
            "List all available workspaces. Returns id, name, and description for each. " +
            "Call this FIRST before any file operation to get a valid workspace_id.",
        schema: z.object({}),
    },
    async () => {
        try {
            const ids = workspaceManager.list();
            if (ids.length === 0) {
                return ok({ workspaces: [], hint: "No workspaces registered yet" });
            }

            const workspaces = ids.map(id => {
                const ws = workspaceManager.get(id)!;
                return {
                    id: ws.config.id,
                    name: ws.config.name,
                    description: ws.config.desc ?? "",
                };
            });

            return ok({ workspaces });
        } catch (error: any) {
            return fail("Failed to list workspaces: " + error.message);
        }
    },
);

const listWorkspaceFilesTool = defineTool(
    {
        name: "list_workspace_files",
        description:
            "List files in a workspace, optionally filtered by a glob pattern. " +
            "Use glob to narrow results: '**/*.ts' for all TypeScript files, " +
            "'src/**/*.test.ts' for test files under src/, '*.md' for top-level markdown. " +
            "If glob is omitted, all files are returned. " +
            "Supports ** (any depth), * (any name), ? (single char), {a,b} (alternation).",
        schema: z.object({
            workspace_id: z.string().describe("Workspace ID (get from list_workspaces)"),
            glob: z.string().optional().describe(
                "Glob pattern to filter files, e.g. '**/*.ts', 'src/**/*.ts', '*.json'. Omit to list all files."
            ),
        }),
    },
    async ({workspace_id, glob}) => {
        try {
            const ws = workspaceManager.getOrThrow(workspace_id);
            const allFiles = await ws.listFiles();

            let files = allFiles;
            if (glob) {
                const regex = globToRegex(glob);
                files = allFiles.filter(f => regex.test(f));
            }

            return ok({
                workspace: ws.config.name,
                file_count: files.length,
                total_count: allFiles.length,
                glob: glob ?? null,
                files: files.map(f => ({ path: f, fileid: makeFileId(workspace_id, f) })),
            });
        } catch (error: any) {
            return fail("Failed to list files: " + error.message);
        }
    },
);

const readFileSchema = z.object({
    workspace_id: z.string().describe("Workspace ID (get from list_workspaces)"),
    file_path: z.string().describe("Relative file path (get from list_workspace_files)"),
    offset: z.number().int().min(0).optional().describe("Start reading from this line (0-based, default 0)"),
    limit: z.number().int().min(1).optional().describe("Max lines to read (default: read all)"),
});

const readWorkspaceFileTool = defineTool(
    {
        name: "read_workspace_file",
        description:
            "Read content from a file in a workspace. " +
            "Use offset/limit to read large files in chunks. " +
            "Returns total line count and the requested slice of content. " +
            "If the file has more lines beyond limit, a hint is included with the next offset value.",
        schema: readFileSchema,
    },
    async ({workspace_id, file_path, offset, limit}) => {
        try {
            const ws = workspaceManager.getOrThrow(workspace_id);
            const content = await ws.readFile(file_path);

            const lines = content.split("\n");
            const totalLines = lines.length;

            const start = offset ?? 0;
            const end = limit ? Math.min(start + limit, totalLines) : totalLines;

            if (start >= totalLines) {
                return fail("Offset " + start + " exceeds total lines " + totalLines);
            }

            const selected = lines.slice(start, end);

            const result: Record<string, unknown> = {
                workspace: ws.config.name,
                file: file_path,
                fileid: makeFileId(workspace_id, file_path),
                total_lines: totalLines,
                lines_read: (start + 1) + "-" + end,
                content: selected.join("\n"),
            };

            if (end < totalLines) {
                result.hint = "File has " + (totalLines - end) + " more lines. Use offset=" + end + " to continue reading.";
            }

            return ok(result);
        } catch (error: any) {
            return fail("Failed to read file: " + error.message);
        }
    },
);

const writeWorkspaceFileTool = defineTool(
    {
        name: "write_workspace_file",
        description:
            "Write or edit a file in a workspace. Two modes: " +
            "1) Full write — provide 'content' (and optional 'append') to write/append the entire file. " +
            "2) Patch — provide 'edits' as [{search, replace}] to apply targeted search-and-replace " +
            "operations in order. Each search string must match exactly once. " +
            "Creates parent directories automatically. Pass either 'content' or 'edits', not both.",
        schema: z.object({
            workspace_id: z.string().describe("Workspace ID (get from list_workspaces)"),
            file_path: z.string().describe("Relative file path to write to"),
            content: z.string().optional().describe(
                "Full text content to write. Use with 'append' flag. Mutually exclusive with 'edits'."
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
    async ({workspace_id, file_path, content, append, edits}) => {
        try {
            const ws = workspaceManager.getOrThrow(workspace_id);

            if (edits && edits.length > 0) {
                // Patch mode
                const result = await ws.patchFile(file_path, edits);
                return ok({
                    workspace: ws.config.name,
                    file: file_path,
                    fileid: makeFileId(workspace_id, file_path),
                    mode: "patch",
                    edits_applied: edits.length,
                    patch_result: result,
                });
            }

            // Write mode
            const text = content ?? "";
            await ws.writeFile(file_path, text, append);
            return ok({
                workspace: ws.config.name,
                file: file_path,
                fileid: makeFileId(workspace_id, file_path),
                mode: append ? "append" : "overwrite",
                size_bytes: Buffer.byteLength(text, "utf-8"),
            });
        } catch (error: any) {
            return fail("Failed to write file: " + error.message);
        }
    },
);

// ── 5. search_workspace_file ──

const searchWorkspaceFileTool = defineTool(
    {
        name: "search_workspace_file",
        description:
            "Full-text search across all text files in a workspace. " +
            "Returns matching file paths with the line number and content of each match. " +
            "Use glob to limit the search to specific file types (e.g. '**/*.ts'). " +
            "Case-insensitive by default. Useful for finding where a function, variable, or string is used.",
        schema: z.object({
            workspace_id: z.string().describe("Workspace ID (get from list_workspaces)"),
            query: z.string().describe("Search query (case-insensitive regex-safe substring match)"),
            glob: z.string().optional().describe(
                "Limit search to files matching this glob pattern, e.g. '**/*.ts', '*.md'"
            ),
            max_results: z.number().int().min(1).max(100).default(30).describe(
                "Max total matches to return (default 30)"
            ),
        }),
    },
    async ({ workspace_id, query, glob, max_results }) => {
        try {
            const ws = workspaceManager.getOrThrow(workspace_id);
            const allFiles = await ws.listFiles();

            // Filter by glob if provided
            let files = allFiles;
            if (glob) {
                const regex = globToRegex(glob);
                files = allFiles.filter(f => regex.test(f));
            }

            // Skip binary/common non-text extensions
            const skipExts = new Set([
                ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
                ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".avi",
                ".zip", ".tar", ".gz", ".7z", ".rar",
                ".pdf", ".docx", ".xlsx", ".pptx",
                ".woff", ".woff2", ".ttf", ".eot",
            ]);

            const results: Array<{ file: string; fileid: string; line: number; content: string }> = [];
            const qLower = query.toLowerCase();

            for (const filePath of files) {
                if (results.length >= max_results) break;

                const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
                if (skipExts.has(ext)) continue;

                try {
                    const content = await ws.readFile(filePath);
                    const lines = content.split("\n");
                    for (let i = 0; i < lines.length && results.length < max_results; i++) {
                        if (lines[i].toLowerCase().includes(qLower)) {
                            const trimmed = lines[i].trim().substring(0, 200);
                            results.push({ file: filePath, fileid: makeFileId(workspace_id, filePath), line: i + 1, content: trimmed });
                        }
                    }
                } catch {
                    // Skip unreadable files
                }
            }

            return ok({
                workspace: ws.config.name,
                query,
                glob: glob ?? null,
                total_files_scanned: files.length,
                matches: results.length,
                truncated: results.length >= max_results,
                results,
            });
        } catch (error: any) {
            return fail("Failed to search workspace: " + error.message);
        }
    },
);



// ── Provider ──

export class WorkspaceToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [
            listWorkspacesTool,
            listWorkspaceFilesTool,
            readWorkspaceFileTool,
            writeWorkspaceFileTool,
            searchWorkspaceFileTool,
        ];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "Workspace";
    }

    getDescription(): string {
        return "Workspace file tools — browse, read, write, search, edit, and publish files";
    }
}
