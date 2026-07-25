/**
 * Agent Loader — scans /agents/{name}/AGENT.md and creates FolderAgent instances.
 *
 * Directory structure:
 *   agents/
 *     default/
 *       AGENT.md          # YAML frontmatter: name, description, tools, prompt
 *       few-shot.json      # Optional few-shot examples
 *     my-agent/
 *       AGENT.md
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { getLogger } from "../utils/logs.js";
import { AgentConfig } from "./agent_config.js";
import { FolderAgent } from "./agents/folder_agent.js";
import { agentRegistry } from "./agent_registry.js";

const logger = getLogger("AgentLoader");

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const AGENTS_DIR = resolve(ROOT, "agents");

/** Simple YAML frontmatter parser. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
    const normalized = raw.replace(/\r\n/g, "\n");
    let body = normalized;
    const meta: Record<string, string> = {};
    if (normalized.startsWith("---\n")) {
        const endIdx = normalized.indexOf("\n---", 4);
        if (endIdx !== -1) {
            const header = normalized.slice(4, endIdx);
            body = normalized.slice(endIdx + 4).trim();
            for (const line of header.split("\n")) {
                const colonIdx = line.indexOf(":");
                if (colonIdx > 0) {
                    meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
                }
            }
        }
    }
    return { meta, body };
}

/** Parse tools field: "ask_user, finish_task" or "[ask_user, finish_task]" → string[] */
function parseTools(raw: string): string[] {
    return raw
        .replace(/[\[\]"]/g, "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

/** Load a single agent from its directory. */
async function loadAgent(dirPath: string): Promise<AgentConfig | null> {
    const folderName = basename(dirPath);
    const agentMdPath = join(dirPath, "AGENT.md");

    let raw: string;
    try {
        raw = await readFile(agentMdPath, "utf-8");
    } catch {
        logger.warn(`No AGENT.md found in ${folderName}, skipping`);
        return null;
    }

    const { meta, body } = parseFrontmatter(raw);

    const name = meta.name || folderName;
    const description = meta.description || `Agent: ${name}`;
    const toolsRaw = meta.tools || "";
    const tools = parseTools(toolsRaw);
    const as_sub_agent = meta.as_sub_agent
        ? meta.as_sub_agent.toLowerCase() !== "false"
        : false;

    return { name, description, tools, as_sub_agent, prompt: body, sourceDir: dirPath };
}

/** Load few-shot examples from agent directory. */
async function loadFewShot(dirPath: string): Promise<Array<{ human: string; ai: string }>> {
    try {
        const raw = await readFile(join(dirPath, "few-shot.json"), "utf-8");
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter((p: any) => typeof p.human === "string" && typeof p.ai === "string");
    } catch {
        return [];
    }
}

/**
 * Scan /agents/ folder and register all agents with the registry.
 */
export async function bootstrapAgents(): Promise<void> {
    let entries: string[];
    try {
        entries = await readdir(AGENTS_DIR);
    } catch {
        logger.warn(`No agents directory found at ${AGENTS_DIR}`);
        return;
    }

    for (const entry of entries) {
        const entryPath = join(AGENTS_DIR, entry);
        let entryStat;
        try { entryStat = await stat(entryPath); } catch { continue; }
        if (!entryStat.isDirectory() || entry.startsWith(".")) continue;

        const config = await loadAgent(entryPath);
        if (!config) continue;

        const fewShot = await loadFewShot(entryPath);

        const agent = new FolderAgent(config, fewShot);
        agentRegistry.registerAgent(config.name, agent);
        logger.info(`Loaded agent "${config.name}" from /agents/${entry}/`);
    }

    logger.info(`Agent registry bootstrapped with ${agentRegistry.list().length} agent(s)`);
}
