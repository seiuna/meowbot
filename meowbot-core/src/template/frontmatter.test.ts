import { describe, it, expect } from "vitest";
import { parseFrontmatter, buildSkillMeta } from "./frontmatter.js";

describe("parseFrontmatter", () => {
    it("parses YAML arrays and booleans", () => {
        const raw = `---
name: my-skill
description: A test skill
required-providers:
  - Workspace
  - System
as-sub-agent: true
tags:
  - foo
  - bar
---

You are a test skill.
`;
        const doc = parseFrontmatter(raw);
        expect(doc.error).toBeUndefined();
        expect(doc.meta.name).toBe("my-skill");
        expect(doc.meta["required-providers"]).toEqual(["Workspace", "System"]);
        expect(doc.meta["as-sub-agent"]).toBe(true);
        expect(doc.meta.tags).toEqual(["foo", "bar"]);
        expect(doc.body).toBe("You are a test skill.");
    });

    it("returns the raw body when there is no frontmatter", () => {
        const doc = parseFrontmatter("just a body\nno meta");
        expect(doc.meta).toEqual({});
        expect(doc.body).toBe("just a body\nno meta");
    });

    it("reports invalid YAML without throwing", () => {
        const doc = parseFrontmatter("---\nname: [unclosed\n---\nbody");
        expect(doc.error).toBeTruthy();
        expect(typeof doc.body).toBe("string");
    });

    it("recognizes a closing delimiter without a trailing newline", () => {
        const doc = parseFrontmatter("---\nname: eof-skill\n---");
        expect(doc.error).toBeUndefined();
        expect(doc.meta.name).toBe("eof-skill");
        expect(doc.body).toBe("");
    });
});

describe("buildSkillMeta", () => {
    it("normalizes comma-string required-providers", () => {
        const { meta, errors } = buildSkillMeta(
            { "required-providers": "Workspace, System " },
            { name: "s", category: "skill" },
        );
        expect(errors).toEqual([]);
        expect(meta.requiredProviders).toEqual(["Workspace", "System"]);
    });

    it("normalizes string as-sub-agent", () => {
        const { meta } = buildSkillMeta(
            { "as-sub-agent": "false" },
            { name: "s", category: "prompt" },
        );
        expect(meta.asSubAgent).toBe(false);
    });

    it("falls back to the provided name when missing", () => {
        const { meta } = buildSkillMeta({}, { name: "fallback-name", category: "template" });
        expect(meta.name).toBe("fallback-name");
        expect(meta.category).toBe("template");
    });

    it("collects errors and sanitizes invalid values", () => {
        const { meta, errors } = buildSkillMeta(
            { requiredProviders: [123, "Workspace"] },
            { name: "s", category: "skill" },
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(meta.requiredProviders).toEqual(["Workspace"]);
    });

    it("warns on unknown frontmatter keys", () => {
        const { errors } = buildSkillMeta(
            { "requried-providers": "Workspace" },
            { name: "s", category: "skill" },
        );
        expect(errors.some(e => e.includes("unknown frontmatter key"))).toBe(true);
    });
});
