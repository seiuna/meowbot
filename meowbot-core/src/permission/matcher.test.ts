import { describe, it, expect } from "vitest";
import { evaluatePermission, matchPattern, parsePermissionExpression, parseRule } from "./matcher.js";

describe("parsePermissionExpression", () => {
    it("splits space-separated rules", () => {
        expect(parsePermissionExpression("command.a !command.b user.ask")).toEqual([
            "command.a",
            "!command.b",
            "user.ask",
        ]);
    });

    it("ignores extra whitespace", () => {
        expect(parsePermissionExpression("  command.a   !command.b  ")).toEqual([
            "command.a",
            "!command.b",
        ]);
    });
});

describe("parseRule", () => {
    it("detects deny rules", () => {
        const rule = parseRule("!command.a");
        expect(rule.deny).toBe(true);
        expect(rule.pattern).toEqual(["command", "a"]);
    });

    it("detects allow rules", () => {
        const rule = parseRule("command.a");
        expect(rule.deny).toBe(false);
        expect(rule.pattern).toEqual(["command", "a"]);
    });
});

describe("matchPattern", () => {
    it("matches exact segments", () => {
        expect(matchPattern(["command", "a"], ["command", "a"])).toBe(true);
        expect(matchPattern(["command", "a"], ["command", "b"])).toBe(false);
    });

    it("matches single-segment wildcard", () => {
        expect(matchPattern(["command", "*"], ["command", "a"])).toBe(true);
        expect(matchPattern(["command", "*"], ["command", "a", "b"])).toBe(false);
    });

    it("matches multi-segment wildcard at end", () => {
        expect(matchPattern(["command", "**"], ["command", "a"])).toBe(true);
        expect(matchPattern(["command", "**"], ["command", "a", "b", "c"])).toBe(true);
    });

    it("does not match beyond exact depth", () => {
        expect(matchPattern(["command", "a"], ["command", "a", "b"])).toBe(false);
    });
});

describe("evaluatePermission", () => {
    it("denies when no rules match", () => {
        expect(evaluatePermission(["command.a"], "command.b")).toEqual({ allowed: false });
    });

    it("allows explicit allow", () => {
        const result = evaluatePermission(["command.a"], "command.a");
        expect(result.allowed).toBe(true);
        expect(result.decidedBy).toBe("command.a");
    });

    it("denies explicit deny", () => {
        const result = evaluatePermission(["!command.a"], "command.a");
        expect(result.allowed).toBe(false);
        expect(result.decidedBy).toBe("!command.a");
    });

    it("deny wins over allow at same specificity", () => {
        const result = evaluatePermission(["command.*", "!command.a"], "command.a");
        expect(result.allowed).toBe(false);
    });

    it("deny-first: wildcard deny blocks even with specific allow", () => {
        const result = evaluatePermission(["!command.*", "command.a"], "command.a");
        expect(result.allowed).toBe(false);
        expect(result.decidedBy).toBe("!command.*");
    });

    it("deny-first: deny prefix matches sub-items", () => {
        // !session should also block session.new, session.list etc.
        expect(evaluatePermission(["!session", "*"], "session").allowed).toBe(false);
        expect(evaluatePermission(["!session", "*"], "session.new").allowed).toBe(false);
        expect(evaluatePermission(["!session", "*"], "session.list.detail").allowed).toBe(false);
        // But should NOT block other resources
        expect(evaluatePermission(["!session", "*"], "command.clear").allowed).toBe(true);
        expect(evaluatePermission(["!session", "*"], "user.ask").allowed).toBe(true);
    });

    it("matches user's example expression", () => {
        const rules = ["!command.a", "user.ask", "command.*"];
        // !command.a matches command.a → deny
        expect(evaluatePermission(rules, "command.a").allowed).toBe(false);
        // command.* matches command.b → allow
        expect(evaluatePermission(rules, "command.b").allowed).toBe(true);
        // user.ask matches → allow
        expect(evaluatePermission(rules, "user.ask").allowed).toBe(true);
        // no rule matches → deny by default
        expect(evaluatePermission(rules, "user.delete").allowed).toBe(false);
    });
});
