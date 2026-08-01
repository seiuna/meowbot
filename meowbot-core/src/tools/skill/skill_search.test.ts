import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "@meowbot/template/prompts.js";
import { searchSkills } from "./skill_search.js";

describe("searchSkills", () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "meowbot-skillsearch-"));
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
        await fs.writeFile(
            path.join(templatesDir, "writer.md"),
            "---\nname: writer-tpl\ndescription: writes documents\n---\n\ntemplate",
            "utf-8",
        );
        await fs.writeFile(
            path.join(templatesDir, "writer2.md"),
            "---\nname: writer2-tpl\ndescription: writes documents too\n---\n\ntemplate2",
            "utf-8",
        );
        await fs.mkdir(promptsDir, { recursive: true });

        SkillRegistry.configure({ skillsDir, templatesDir, promptsDir });
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it("returns matching skills with their tools", async () => {
        const res = await searchSkills("writer");
        expect(res.results[0].name).toBe("writer");
        expect(res.results[0].tools).toEqual(["read_file", "write_file"]);
    });

    it("filters by category", async () => {
        const res = await searchSkills("writer", { category: "template" });
        expect(res.results).toHaveLength(2);
        expect(res.results.every(r => r.name.endsWith("-tpl"))).toBe(true);
    });

    it("respects the limit", async () => {
        const res = await searchSkills("writes", { category: "template", limit: 1 });
        expect(res.results).toHaveLength(1);
    });
});
