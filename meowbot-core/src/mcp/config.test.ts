import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadMCPConfig } from "./config.js";

const TEST_DIR = join(process.cwd(), "tmp-mcp-config-test");

describe("loadMCPConfig", () => {
    beforeEach(async () => {
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    it("returns empty config when file does not exist", async () => {
        const config = await loadMCPConfig(join(TEST_DIR, "missing.json"));
        expect(config.mcpServers).toEqual({});
    });

    it("loads valid MCP config", async () => {
        const path = join(TEST_DIR, "mcp.json");
        await writeFile(
            path,
            JSON.stringify({
                mcpServers: {
                    math: {
                        name: "math-provider",
                        transport: "stdio",
                        command: "npx",
                        args: ["-y", "@modelcontextprotocol/server-math"],
                    },
                },
            })
        );

        const config = await loadMCPConfig(path);
        expect(config.mcpServers.math).toBeDefined();
        expect(config.mcpServers.math.name).toBe("math-provider");
        expect(config.mcpServers.math.command).toBe("npx");
    });
});
