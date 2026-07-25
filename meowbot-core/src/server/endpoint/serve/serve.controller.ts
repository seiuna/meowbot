import { Controller, Get, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { readFile, stat } from "fs/promises";
import { resolve } from "path";
import { WorkspaceManager } from "../../../workspace/workspace.js";

const WORKSPACE_DIR = resolve(import.meta.dirname, "..", "..", "..", "..", "..", "workspace");

function safePath(p: string): string {
  const r = resolve(WORKSPACE_DIR, p);
  if (!r.startsWith(resolve(WORKSPACE_DIR))) throw new Error("Path traversal denied");
  return r;
}

@Controller()
export class ServeController {
  @Get(":ws/file")
  async serveFile(@Param("ws") ws: string, @Res() res: Response) {
    // Extract file path from query
    const filePath = (res.req as any).query?.path as string;
    if (!filePath) return res.status(400).send("Missing ?path= query parameter");

    try {
      const full = safePath(filePath);
      const content = await readFile(full);
      const s = await stat(full);
      const ext = filePath.split(".").pop()?.toLowerCase() || "";
      const mime: Record<string, string> = {
        html: "text/html", css: "text/css", js: "application/javascript",
        json: "application/json", png: "image/png", jpg: "image/jpeg",
        svg: "image/svg+xml", pdf: "application/pdf", txt: "text/plain",
        md: "text/markdown", yaml: "text/yaml", yml: "text/yaml",
      };
      res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
      res.setHeader("Content-Length", s.size);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(content);
    } catch (err: any) {
      if (err.code === "ENOENT") return res.status(404).send("File not found");
      return res.status(500).send("Error: " + (err.message || String(err)));
    }
  }
}
