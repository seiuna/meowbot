import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "@meowbot/template/prompts.js";
import { SkillToolProvider } from "./skill_tools.js";

describe("search_skill", () => {
    let tmp: string;
    let tools: Record<string, any>;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "meowbot-skilltools-"));
        const skillsDir = path.join(tmp, "skills");
        const templatesDir = path.join(tmp, "templates");
        const promptsDir = path.join(tmp, "prompts");

        await fs.mkdir(path.join(skillsDir, "writer"), { recursive: true });
        await fs.writeFile(
            path.join(skillsDir, "writer", "skill.md"),
            "---\nname: writer\ndescription: writes documents\ntools:\n  - read_file\n  - write_file\n---\n\nYou are a writer.",
            "utf-8",
        );
        await fs.mkdir(templatesDir, { recursive: true });
        await fs.mkdir(promptsDir, { recursive: true });

        SkillRegistry.configure({ skillsDir, templatesDir, promptsDir });

        const provider = new SkillToolProvider();
        tools = Object.fromEntries(provider.pullAllTools().map(t => [t.name, t]));
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it("text search returns the tools field", async () => {
        const res = JSON.parse(await tools.search_skill.invoke({ query: "writer" }));
        expect(res.ok).toBe(true);
        expect(res.skills[0].name).toBe("writer");
        expect(res.skills[0].tools).toEqual(["read_file", "write_file"]);
        expect(res.skills[0].providers).toEqual([]);
    });
});
