import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillDirectory } from "./skill-loader.js";

describe("loadSkillDirectory", () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "meowbot-skill-"));
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it("loads folder-per-skill with frontmatter + few-shot", async () => {
        const skillDir = path.join(tmp, "skills");
        await fs.mkdir(path.join(skillDir, "hello"), { recursive: true });
        await fs.writeFile(
            path.join(skillDir, "hello", "skill.md"),
            `---\nname: hello\nrequired-providers:\n  - Workspace\n---\n\nYou are hello.`,
            "utf-8",
        );
        await fs.writeFile(
            path.join(skillDir, "hello", "few-shot.json"),
            JSON.stringify([{ human: "hi", ai: "hello!" }]),
            "utf-8",
        );

        const result = await loadSkillDirectory(skillDir, "skill");
        expect(result.errors).toEqual([]);
        const skill = result.skills.get("hello");
        expect(skill).toBeDefined();
        expect(skill!.meta.requiredProviders).toEqual(["Workspace"]);
        expect(skill!.prompt()).toBe("You are hello.");
        expect(skill!.fewShotCount).toBe(1);
    });

    it("does not load few-shot for templates", async () => {
        const tplDir = path.join(tmp, "templates");
        await fs.mkdir(path.join(tplDir, "msg"), { recursive: true });
        await fs.writeFile(path.join(tplDir, "msg", "skill.md"), "---\nname: msg\n---\n\nHello", "utf-8");
        await fs.writeFile(path.join(tplDir, "msg", "few-shot.json"), JSON.stringify([{ human: "h", ai: "a" }]), "utf-8");

        const result = await loadSkillDirectory(tplDir, "template");
        expect(result.skills.get("msg")!.fewShotCount).toBe(0);
    });

    it("loads flat .md files", async () => {
        await fs.writeFile(
            path.join(tmp, "flat.md"),
            `---\ndescription: flat template\n---\n\nHello ${"${name}"}`,
            "utf-8",
        );

        const result = await loadSkillDirectory(tmp, "template");
        const skill = result.skills.get("flat");
        expect(skill).toBeDefined();
        expect(skill!.prompt({ name: "Codex" })).toBe("Hello Codex");
    });

    it("collects validation errors instead of crashing", async () => {
        await fs.writeFile(path.join(tmp, "broken.md"), "---\nname: [unclosed\n---\nbody", "utf-8");
        await fs.writeFile(path.join(tmp, "ok.md"), "---\nname: ok\n---\n\nfine", "utf-8");

        const result = await loadSkillDirectory(tmp, "prompt");
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.skills.has("ok")).toBe(true);
    });

    it("records duplicate names within one directory", async () => {
        await fs.mkdir(path.join(tmp, "dup1"), { recursive: true });
        await fs.mkdir(path.join(tmp, "dup2"), { recursive: true });
        const md = "---\nname: dup\n---\n\nx";
        await fs.writeFile(path.join(tmp, "dup1", "skill.md"), md, "utf-8");
        await fs.writeFile(path.join(tmp, "dup2", "skill.md"), md, "utf-8");

        const result = await loadSkillDirectory(tmp, "skill");
        expect(result.skills.size).toBe(1);
        expect(result.errors.some(e => e.includes("Duplicate"))).toBe(true);
    });
});
