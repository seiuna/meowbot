import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { SimpleToolProvider, toolRegistry } from "./tool_registry.js";
import { Skill } from "../template/skill.js";

function makeTool(name: string) {
    return tool(async () => "ok", { name, description: name, schema: z.object({}) });
}

describe("ToolRegistry.getToolsByName", () => {
    const PROVIDER = "test-provider-by-name";

    beforeEach(() => {
        toolRegistry.register(new SimpleToolProvider(PROVIDER, "test", [makeTool("fake_read")]));
    });

    afterEach(() => {
        toolRegistry.unregister(PROVIDER);
    });

    it("returns enabled tools by exact name", () => {
        const tools = toolRegistry.getToolsByName(["fake_read"]);
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe("fake_read");
    });

    it("skips unknown names", () => {
        expect(toolRegistry.getToolsByName(["missing_tool"])).toEqual([]);
    });
});

describe("Skill.tools() binding", () => {
    const PROVIDER = "test-provider-skill";

    beforeEach(() => {
        toolRegistry.register(new SimpleToolProvider(PROVIDER, "test", [makeTool("fake_read")]));
    });

    afterEach(() => {
        toolRegistry.unregister(PROVIDER);
    });

    it("prefers explicit tools over providers", () => {
        const skill = new Skill(
            {
                name: "s",
                description: "",
                tools: ["fake_read"],
                requiredProviders: [PROVIDER],
                asSubAgent: false,
                category: "skill",
                tags: [],
            },
            "body",
        );
        expect(skill.tools().map(t => t.name)).toEqual(["fake_read"]);
    });

    it("falls back to provider binding when tools is empty", () => {
        const skill = new Skill(
            {
                name: "s",
                description: "",
                tools: [],
                requiredProviders: [PROVIDER],
                asSubAgent: false,
                category: "skill",
                tags: [],
            },
            "body",
        );
        expect(skill.tools().map(t => t.name)).toEqual(["fake_read"]);
    });
});
