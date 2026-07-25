import { describe, it, expect } from "vitest";
import { Command, checkScope, parseScopeRules } from "./command.js";

describe("Command.require()", () => {
    it("stores a single required permission", () => {
        const cmd = new Command("admin").require("admin.user");
        expect(cmd.requiredPermissions).toEqual(["admin.user"]);
    });

    it("chains multiple required permissions", () => {
        const cmd = new Command("admin")
            .require("admin.user")
            .require("admin.setting");
        expect(cmd.requiredPermissions).toEqual(["admin.user", "admin.setting"]);
    });

    it("supports variadic require call", () => {
        const cmd = new Command("admin").require("a", "b", "c");
        expect(cmd.requiredPermissions).toEqual(["a", "b", "c"]);
    });

    it("preserves required permissions on child nodes", () => {
        const root = new Command("root");
        const child = new Command("child").require("child.perm");
        root.children.set("child", child);
        expect(root.children.get("child")!.requiredPermissions).toEqual(["child.perm"]);
    });
});

describe("Command.scope()", () => {
    it("stores a single adapter rule", () => {
        const cmd = new Command("qq-only").scope("qq");
        expect(cmd.scopeRules).toEqual(["qq"]);
    });

    it("stores multiple adapter rules", () => {
        const cmd = new Command("not-qq").scope("all", "!qq");
        expect(cmd.scopeRules).toEqual(["all", "!qq"]);
    });

    it("supports chaining scope calls", () => {
        const cmd = new Command("multi").scope("telegram").scope("discord");
        expect(cmd.scopeRules).toEqual(["telegram", "discord"]);
    });
});

describe("parseScopeRules", () => {
    it("parses positive adapter rules", () => {
        expect(parseScopeRules(["qq"])).toEqual({ positive: ["qq"], negative: [] });
        expect(parseScopeRules(["telegram", "discord"])).toEqual({
            positive: ["telegram", "discord"],
            negative: [],
        });
    });

    it("parses all wildcard", () => {
        expect(parseScopeRules(["all"])).toEqual({ positive: ["all"], negative: [] });
        expect(parseScopeRules(["*"])).toEqual({ positive: ["all"], negative: [] });
    });

    it("parses negative adapter rules", () => {
        expect(parseScopeRules(["!qq"])).toEqual({ positive: [], negative: ["qq"] });
        expect(parseScopeRules(["all", "!qq"])).toEqual({ positive: ["all"], negative: ["qq"] });
    });
});

describe("checkScope", () => {
    it("allows only specified adapter", () => {
        expect(checkScope(["qq"], "qq")).toBe(true);
        expect(checkScope(["qq"], "telegram")).toBe(false);
    });

    it("allows all except excluded adapter", () => {
        expect(checkScope(["all", "!qq"], "telegram")).toBe(true);
        expect(checkScope(["all", "!qq"], "qq")).toBe(false);
    });

    it("negative-only rule defaults to allowing everything else", () => {
        expect(checkScope(["!qq"], "telegram")).toBe(true);
        expect(checkScope(["!qq"], "qq")).toBe(false);
    });

    it("allows multiple positive adapters", () => {
        expect(checkScope(["telegram", "discord"], "telegram")).toBe(true);
        expect(checkScope(["telegram", "discord"], "discord")).toBe(true);
        expect(checkScope(["telegram", "discord"], "qq")).toBe(false);
    });

    it("no rules means allowed", () => {
        expect(checkScope([], "qq")).toBe(true);
    });
});
