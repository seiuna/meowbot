import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "./skill-registry.js";
import { Skill } from "./skill.js";

describe("SkillRegistry", () => {
    let tmp: string;
    let skillsDir: string;
    let templatesDir: string;
    let promptsDir: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "meowbot-registry-"));
        skillsDir = path.join(tmp, "skills");
        templatesDir = path.join(tmp, "templates");
        promptsDir = path.join(tmp, "prompts");
        await fs.mkdir(skillsDir, { recursive: true });
        await fs.mkdir(templatesDir, { recursive: true });
        await fs.mkdir(promptsDir, { recursive: true });

        await fs.mkdir(path.join(skillsDir, "writer"), { recursive: true });
        await fs.writeFile(
            path.join(skillsDir, "writer", "skill.md"),
            "---\nname: writer\nrequired-providers:\n  - Workspace\n---\n\nYou are a writer.",
            "utf-8",
        );
        await fs.writeFile(
            path.join(templatesDir, "greet.md"),
            "---\nname: greet\n---\n\nHi ${name}",
            "utf-8",
        );
        await fs.writeFile(
            path.join(promptsDir, "analyst.md"),
            "---\nname: analyst\nas-sub-agent: true\n---\n\nYou are an analyst.",
            "utf-8",
        );

        SkillRegistry.configure({ skillsDir, templatesDir, promptsDir });
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it("lists skills by category", async () => {
        expect(await SkillRegistry.listSkills()).toEqual(["writer"]);
        expect(await SkillRegistry.listTemplates()).toEqual(["greet"]);
        expect(await SkillRegistry.listPrompts()).toEqual(["analyst"]);
        expect(await SkillRegistry.list()).toEqual(["writer", "greet", "analyst"]);
    });

    it("shares a single load across concurrent callers", async () => {
        SkillRegistry.configure({ skillsDir, templatesDir, promptsDir }); // invalidate cache
        const [skills, templates, writer] = await Promise.all([
            SkillRegistry.listSkills(),
            SkillRegistry.listTemplates(),
            SkillRegistry.get("writer"),
        ]);
        expect(skills).toEqual(["writer"]);
        expect(templates).toEqual(["greet"]);
        expect(writer?.prompt()).toBe("You are a writer.");
    });

    it("builds rendered templates and prompts", async () => {
        expect(await SkillRegistry.build("greet", { name: "Codex" })).toBe("Hi Codex");
        expect(await SkillRegistry.build("writer", {})).toBe("You are a writer.");
    });

    it("exposes metadata", async () => {
        const meta = await SkillRegistry.getMeta("analyst");
        expect(meta).not.toBeNull();
        expect(meta!.asSubAgent).toBe(true);
        expect(meta!.category).toBe("prompt");
        expect(meta!.content).toContain("analyst");
    });

    it("collects load errors and surfaces them", async () => {
        await fs.writeFile(path.join(templatesDir, "bad.md"), "---\nname: [x\n---\n", "utf-8");
        await SkillRegistry.reload();
        expect(SkillRegistry.getLoadErrors().length).toBeGreaterThan(0);
    });

    it("reload picks up newly added files", async () => {
        await fs.writeFile(path.join(promptsDir, "late.md"), "---\nname: late\n---\n\nlate prompt", "utf-8");
        await SkillRegistry.reload();
        expect(await SkillRegistry.getRaw("late")).toBe("late prompt");
    });

    it("dynamic (plugin) skills survive reload and never override scanned ones", async () => {
        await SkillRegistry.registerDynamic(
            new Skill(
                {
                    name: "plugin-skill",
                    description: "",
                    requiredProviders: [],
                    asSubAgent: false,
                    category: "skill",
                },
                "plugin body",
            ),
        );
        expect(await SkillRegistry.getRaw("plugin-skill")).toBe("plugin body");

        await SkillRegistry.reload();
        expect(await SkillRegistry.getRaw("plugin-skill")).toBe("plugin body");

        // Scanned skill with the same name wins.
        await SkillRegistry.registerDynamic(
            new Skill(
                { name: "writer", description: "", requiredProviders: [], asSubAgent: false, category: "skill" },
                "should not win",
            ),
        );
        expect(await SkillRegistry.getRaw("writer")).toBe("You are a writer.");
    });
});
