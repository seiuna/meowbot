import { describe, it, expect } from "vitest";
import { globToRegex } from "./glob.js";

describe("globToRegex", () => {
    it("matches the directory itself for dir/**", () => {
        const re = globToRegex("e:/project/meowbot/**");
        expect(re.test("e:/project/meowbot")).toBe(true);
        expect(re.test("e:/project/meowbot/src/a.ts")).toBe(true);
        expect(re.test("e:/project/other/x")).toBe(false);
    });

    it("matches zero segments for a/**/b", () => {
        const re = globToRegex("a/**/b");
        expect(re.test("a/b")).toBe(true);
        expect(re.test("a/x/b")).toBe(true);
        expect(re.test("a/x/y/b")).toBe(true);
        expect(re.test("a/c")).toBe(false);
    });

    it("matches root-level files for **/*.ts", () => {
        const re = globToRegex("**/*.ts");
        expect(re.test("a.ts")).toBe(true);
        expect(re.test("src/a.ts")).toBe(true);
    });

    it("is case-insensitive when requested", () => {
        const re = globToRegex("**/Secret/**", true);
        expect(re.test("E:/x/Secret/a.txt")).toBe(true);
        expect(re.test("e:/x/secret/a.txt")).toBe(true);
        expect(re.test("E:/x/visible/a.txt")).toBe(false);
    });

    it("is case-sensitive by default", () => {
        const re = globToRegex("**/Secret/**");
        expect(re.test("E:/x/secret/a.txt")).toBe(false);
        expect(re.test("E:/x/Secret/a.txt")).toBe(true);
    });
});
