import { Controller, Get, Post, Body, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join, resolve, relative } from "path";
import { agentRegistry } from "../../../agent/agent_registry.js";
import { commandRegistry } from "../../../command/dispatcher.js";
import { toolRegistry } from "../../../tools/tool_registry.js";
import { TokenStore } from "../../../llm/token_store.js";
import { Prompts } from "../../../template/prompts.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const WORKSPACE_DIR = resolve(import.meta.dirname, "..", "..", "..", "..", "workspace");
const PROMPTS_DIR = join(WORKSPACE_DIR, "prompts");
const SKILLS_DIR = join(WORKSPACE_DIR, "skills");
const CONFIG_PATH = resolve(import.meta.dirname, "..", "..", "..", "config", "config.json");

function safePath(dir: string, p: string): string {
  const r = resolve(dir, p);
  if (!r.startsWith(resolve(dir))) throw new Error("Path traversal denied");
  return r;
}

@Controller("api")
export class ApiController {
  // ── Stats / Agents / Tools ──

  @Get("stats") async stats() {
    const agents = agentRegistry.list().length;
    const tools = toolRegistry.getAllTools().filter((t: any) => t.isEnabled !== false).length;
    const ts = await TokenStore.getInstance().getStats();
    return { agents, tools, total_calls: ts.total_calls, total_input: ts.total_input, total_output: ts.total_output, by_model: ts.byModel };
  }

  @Get("agents") agents() {
    return agentRegistry.list().map(id => { const a = agentRegistry.getAgent(id)!; return { id, name: a.name, description: a.description, threads: a.getActiveThreadCount() }; });
  }

  @Get("tools") tools() {
    return toolRegistry.getProviders().map(p => ({
      name: p.getName(), description: p.getDescription(),
      tools: p.pullAllTools().map(t => ({ name: t.name, description: t.description, isEnabled: (t as any).isEnabled !== false, perms: (t as any).perms ?? [], required: (t as any).required ?? false })),
    }));
  }

  @Post("tools/toggle")
  toggleTool(@Body() body: { name: string; enabled: boolean }) {
    const all = toolRegistry.getAllTools();
    const tool = all.find(t => t.name === body.name);
    if (!tool) return { ok: false, error: "Tool not found" };
    (tool as any).isEnabled = body.enabled;
    return { ok: true, name: body.name, isEnabled: body.enabled };
  }

  @Get("tokens") async tokens() { return TokenStore.getInstance().getStats(); }

  // ── Commands ──
  @Get("commands") commands() {
    const roots = (commandRegistry as any).rootCommands as Map<string, any>;
    const result: any[] = [];
    const walk = (node: any, prefix: string) => {
      if (!node) return;
      const path = prefix ? prefix + " " + node.name : "/" + node.name;
      const info: any = { path, description: node.description || "", requiredPermissions: node.requiredPermissions || [] };
      if (node.argChild) { info.args = node.argChild.name; walk(node.argChild, path); }
      if (node.children) {
        for (const [name, child] of node.children) {
          if (name !== child.name) continue; // skip aliases
          walk(child, path);
        }
      }
      result.push(info);
    };
    roots?.forEach(node => walk(node, ""));
    return result;
  }

  // ── Config ──

  @Get("config") async getConfig() {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  }

  @Post("config") async saveConfig(@Body() body: any) {
    await writeFile(CONFIG_PATH, JSON.stringify(body, null, 2), "utf-8");
    return { ok: true };
  }

  // ── Workspace files ──

  @Get("workspace/tree")
  async workspaceTree(@Query("dir") dir: string = "") {
    const base = dir ? safePath(WORKSPACE_DIR, dir) : WORKSPACE_DIR;
    const items: any[] = [];
    const entries = await readdir(base, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(base, e.name);
      items.push({ name: e.name, path: relative(WORKSPACE_DIR, full).replace(/\\/g, "/"), type: e.isDirectory() ? "dir" : "file" });
    }
    items.sort((a: any, b: any) => (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1) || a.name.localeCompare(b.name));
    return items;
  }

  @Get("workspace/file")
  async workspaceFile(@Query("path") path: string) {
    const full = safePath(WORKSPACE_DIR, path);
    const content = await readFile(full, "utf-8");
    const s = await stat(full);
    return { path, content, size: s.size };
  }

  @Post("workspace/file")
  async workspaceWrite(@Body() body: { path: string; content: string }) {
    const full = safePath(WORKSPACE_DIR, body.path);
    await writeFile(full, body.content, "utf-8");
    return { ok: true };
  }

  @Get("workspace/download")
  async workspaceDownload(@Query("path") path: string, @Res() res: Response) {
    const full = safePath(WORKSPACE_DIR, path);
    const content = await readFile(full);
    res.setHeader("Content-Disposition", "attachment; filename=\"" + path.split("/").pop() + "\"");
    res.send(content);
  }

  // ── Prompts ──
  @Get("prompts") async promptsList() {
    const ids = await Prompts.list();
    const items: any[] = [];
    for (const id of ids) {
      const meta = await Prompts.getMeta(id);
      const content = meta?.content ?? "";
      items.push({
        name: id,
        description: meta?.description ?? "",
        requiredProviders: meta?.requiredProviders ?? [],
        content,
        preview: content.substring(0, 100),
      });
    }
    return items;
  }

  @Get("prompts/file")
  async promptsGet(@Query("name") name: string) {
    const meta = await Prompts.getMeta(name);
    return { name, content: meta?.content ?? "", description: meta?.description ?? "", requiredProviders: meta?.requiredProviders ?? [] };
  }

  @Post("prompts/file")
  async promptsSave(@Body() body: { name: string; content: string }) {
    const fn = body.name.endsWith(".md") ? body.name : body.name + ".md";
    await writeFile(join(PROMPTS_DIR, fn), body.content, "utf-8");
    await Prompts.reload();
    return { ok: true, name: body.name };
  }

  // ── Skills ──
  @Get("skills/file")
  async skillsGet(@Query("name") name: string) {
    const full = safePath(SKILLS_DIR, name + ".md");
    try { return { name, content: await readFile(full, "utf-8") }; } catch { return { name, content: "" }; }
  }

  @Post("skills/file")
  async skillsSave(@Body() body: { name: string; content: string }) {
    const fn = body.name.endsWith(".md") ? body.name : body.name + ".md";
    await writeFile(join(SKILLS_DIR, fn), body.content, "utf-8");
    return { ok: true, name: body.name };
  }
}
