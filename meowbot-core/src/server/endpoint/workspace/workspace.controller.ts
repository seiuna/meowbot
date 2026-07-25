import { Controller, Post, Get, Param, Body, Res } from "@nestjs/common";
import { Response } from "express";
import { WorkspaceManager } from "../../../workspace/workspace.js";

/**
 * Workspace REST API — path-based access via /workspace/{workspaceName}/...
 *
 *   GET  /workspace                    → list all registered workspaces
 *   GET  /workspace/:ws                → list root directory (JSON)
 *   GET  /workspace/:ws/*path          → serve file with proper MIME (binary-safe)
 *   POST /workspace/:ws/*path          → read file (no body) or write (body: { content }) or delete (body: { action: "delete" })
 */

const MIME_MAP: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".bmp": "image/bmp",
  ".pdf": "application/pdf", ".json": "application/json",
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".md": "text/markdown", ".txt": "text/plain",
  ".zip": "application/zip", ".mp3": "audio/mpeg", ".mp4": "video/mp4",
};

function getMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

@Controller("workspace")
export class WorkspaceController {
  // ── List all workspaces ──

  @Get()
  @Post()
  listWorkspaces() {
    const ids = WorkspaceManager.getInstance().list();
    const workspaces = ids.map(id => {
      const ws = WorkspaceManager.getInstance().get(id)!;
      return { id, name: ws.config.name, description: ws.config.desc || "" };
    });
    return { workspaces };
  }

  // ── Workspace root: list directory ──

  @Get(":ws")
  @Post(":ws")
  async workspaceRoot(@Param("ws") ws: string) {
    const mgr = WorkspaceManager.getInstance();
    if (!mgr.has(ws)) {
      return { error: `Workspace not found: ${ws}` };
    }
    const workspace = mgr.getOrThrow(ws);
    try {
      const entries = await workspace.listDirectory();
      return { workspace: ws, type: "directory", path: "", entries };
    } catch (err: any) {
      return { error: err.message || String(err) };
    }
  }

  // ── Serve file directly (GET — binary-safe, with MIME) ──

  @Get(":ws/*path")
  async serveFile(
    @Param("ws") ws: string,
    @Param("path") subPath: string | string[],
    @Res() res: Response,
  ) {
    const filePath = Array.isArray(subPath) ? subPath.join("/") : (subPath ?? "");

    const mgr = WorkspaceManager.getInstance();
    if (!mgr.has(ws)) return res.status(404).send("Workspace not found");

    const workspace = mgr.getOrThrow(ws);
    try {
      const raw = await workspace.readFileRaw(filePath);
      const mime = getMime(filePath);
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", raw.length);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(raw);
    } catch (err: any) {
      if (err.code === "ENOENT" || err.message?.includes("not found")) {
        return res.status(404).send("File not found");
      }
      res.status(500).send("Error: " + (err.message || String(err)));
    }
  }

  // ── Wildcard: file read / write / delete (POST — returns JSON) ──

  @Post(":ws/*path")
  async handlePath(
    @Param("ws") ws: string,
    @Param("path") subPath: string | string[],
    @Body() body?: any,
  ) {
    const filePath = Array.isArray(subPath) ? subPath.join("/") : (subPath ?? "");

    const mgr = WorkspaceManager.getInstance();
    if (!mgr.has(ws)) {
      return { error: `Workspace not found: ${ws}` };
    }
    const workspace = mgr.getOrThrow(ws);

    try {
      // Write
      if (body && typeof body.content === "string") {
        await workspace.writeFile(filePath, body.content);
        return { ok: true, workspace: ws, path: filePath, action: "write" };
      }

      // Delete
      if (body && body.action === "delete") {
        await workspace.deleteFile(filePath);
        return { ok: true, workspace: ws, path: filePath, action: "delete" };
      }

      // Read: try as file first, then as directory
      const fileExists = await workspace.exists(filePath);
      if (fileExists) {
        const content = await workspace.readFile(filePath);
        const contentLength = Buffer.byteLength(content, "utf-8");
        return {
          workspace: ws,
          type: "file",
          path: filePath,
          content,
          size: contentLength,
        };
      }

      // Try as directory listing
      const entries = await workspace.listDirectory(filePath);
      return { workspace: ws, type: "directory", path: filePath, entries };
    } catch (err: any) {
      return { error: err.message || String(err) };
    }
  }
}
