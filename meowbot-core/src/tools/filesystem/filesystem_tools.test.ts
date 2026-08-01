import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemToolProvider } from "./filesystem_tools.js";
import { FsAccessControl, setFsAccessControlForTest } from "./access_control.js";

const allowedSession = {
    threadId: "test-thread",
    event: { userId: "test-user" },
    isAllowed: async () => true,
} as any;

function runConfig() {
    return { configurable: { session: allowedSession } };
}

describe("FileSystemToolProvider", () => {
    let root: string;
    let tools: Record<string, any>;

    beforeEach(async () => {
        setFsAccessControlForTest(new FsAccessControl({ whitelist: [], blacklist: [] }));
        root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbot-fs-"));
        await fs.mkdir(path.join(root, ".git"), { recursive: true });
        await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
        await fs.mkdir(path.join(root, "src"), { recursive: true });
        await fs.writeFile(path.join(root, "src", "app.ts"), "export const x = 1;\n// hello meowbot\n", "utf-8");
        await fs.writeFile(path.join(root, ".git", "secret.txt"), "token=abc\n", "utf-8");
        await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "console.log(1)\n", "utf-8");
        await fs.writeFile(path.join(root, "readme.md"), "# MeowBot\nhello\n", "utf-8");

        const provider = new FileSystemToolProvider();
        tools = Object.fromEntries(provider.pullAllTools().map(t => [t.name, t]));
    });

    afterEach(async () => {
        setFsAccessControlForTest(null);
        await fs.rm(root, { recursive: true, force: true });
    });

    it("write_file creates files with parent directories", async () => {
        const target = path.join(root, "docs", "notes.md");
        const res = JSON.parse(await tools.write_file.invoke({ path: target, content: "hello\nworld\n" }, runConfig()));
        expect(res.ok).toBe(true);
        expect(await fs.readFile(target, "utf-8")).toBe("hello\nworld\n");
    });

    it("write_file supports append and patch modes", async () => {
        const target = path.join(root, "a.txt");
        await tools.write_file.invoke({ path: target, content: "foo\n" }, runConfig());
        await tools.write_file.invoke({ path: target, content: "bar\n", append: true }, runConfig());
        expect(await fs.readFile(target, "utf-8")).toBe("foo\nbar\n");

        const patchRes = JSON.parse(
            await tools.write_file.invoke({ path: target, edits: [{ search: "foo", replace: "FOO" }] }, runConfig()),
        );
        expect(patchRes.ok).toBe(true);
        expect(await fs.readFile(target, "utf-8")).toBe("FOO\nbar\n");
    });

    it("write_file rejects missing or conflicting inputs", async () => {
        const target = path.join(root, "guard.txt");

        const none = JSON.parse(await tools.write_file.invoke({ path: target }, runConfig()));
        expect(none.ok).toBe(false);
        expect(none.error).toContain("exactly one");

        const both = JSON.parse(
            await tools.write_file.invoke(
                { path: target, content: "x", edits: [{ search: "a", replace: "b" }] },
                runConfig(),
            ),
        );
        expect(both.ok).toBe(false);
        expect(both.error).toContain("exactly one");

        const appendEdits = JSON.parse(
            await tools.write_file.invoke(
                { path: target, edits: [{ search: "a", replace: "b" }], append: true },
                runConfig(),
            ),
        );
        expect(appendEdits.ok).toBe(false);
        expect(appendEdits.error).toContain("'append'");

        const exists = await fs.stat(target).then(() => true).catch(() => false);
        expect(exists).toBe(false); // nothing was created
    });

    it("write_file patch mode fails when the file does not exist", async () => {
        const target = path.join(root, "missing", "notes.txt");
        const res = JSON.parse(
            await tools.write_file.invoke({ path: target, edits: [{ search: "a", replace: "b" }] }, runConfig()),
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain("requires an existing file");

        const exists = await fs.stat(target).then(() => true).catch(() => false);
        expect(exists).toBe(false); // no junk file was created
    });

    it("read_file returns content with line counts", async () => {
        const res = JSON.parse(await tools.read_file.invoke({ path: path.join(root, "src", "app.ts") }, runConfig()));
        expect(res.ok).toBe(true);
        expect(res.total_lines).toBe(3); // trailing newline counts as a final empty line
        expect(res.content).toContain("hello meowbot");
    });

    it("list_directory filters denied entries", async () => {
        const res = JSON.parse(await tools.list_directory.invoke({ path: root }, runConfig()));
        expect(res.ok).toBe(true);
        const names = res.entries.map((e: any) => e.name);
        expect(names).toContain("src");
        expect(names).toContain("readme.md");
        expect(names).not.toContain(".git");
        expect(names).not.toContain("node_modules");
    });

    it("search_files finds matches and skips blacklisted subtrees", async () => {
        const res = JSON.parse(await tools.search_files.invoke({ root, query: "meowbot" }, runConfig()));
        expect(res.ok).toBe(true);
        const files = res.results.map((r: any) => r.file);
        expect(files.some(f => f.includes("readme.md"))).toBe(true);
        expect(files.some(f => f.includes("app.ts"))).toBe(true);
        expect(files.some(f => f.includes(".git"))).toBe(false);
        expect(files.some(f => f.includes("node_modules"))).toBe(false);
    });

    it("search_files glob matching is case-insensitive", async () => {
        const res = JSON.parse(
            await tools.search_files.invoke({ root, query: "meowbot", glob: "**/README.MD" }, runConfig()),
        );
        expect(res.ok).toBe(true);
        const files = res.results.map((r: any) => r.file);
        expect(files.some(f => f.includes("readme.md"))).toBe(true);
    });

    it("search_files does not traverse junctions into blacklisted targets", async () => {
        const victim = await fs.mkdtemp(path.join(os.tmpdir(), "meowbot-fs-victim-"));
        const link = path.join(root, "link");
        try {
            await fs.mkdir(path.join(victim, ".git"), { recursive: true });
            await fs.writeFile(path.join(victim, ".git", "secret.txt"), "TOPSECRET\n", "utf-8");
            await fs.symlink(path.join(victim, ".git"), link, process.platform === "win32" ? "junction" : "dir");
        } catch {
            await fs.rm(victim, { recursive: true, force: true });
            return; // junction creation not permitted in this environment — skip
        }

        try {
            const res = JSON.parse(await tools.search_files.invoke({ root, query: "TOPSECRET" }, runConfig()));
            expect(res.ok).toBe(true);
            expect(res.results.some((r: any) => r.file.includes("secret.txt"))).toBe(false);
        } finally {
            await fs.rm(link, { recursive: true, force: true }).catch(() => {});
            await fs.rm(victim, { recursive: true, force: true });
        }
    });

    it("read_file denies blacklisted paths", async () => {
        const res = JSON.parse(await tools.read_file.invoke({ path: path.join(root, ".git", "secret.txt") }, runConfig()));
        expect(res.ok).toBe(false);
        expect(res.error).toContain("denied");
    });

    it("write_file denies blacklisted paths", async () => {
        const res = JSON.parse(
            await tools.write_file.invoke({ path: path.join(root, "node_modules", "pkg", "evil.js"), content: "x" }, runConfig()),
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain("denied");
    });

    it("enforces fs.read permission at the tool layer", async () => {
        const deniedSession = {
            threadId: "test-thread",
            event: { userId: "test-user" },
            isAllowed: async () => false,
        } as any;
        const res = JSON.parse(
            await tools.read_file.invoke(
                { path: path.join(root, "readme.md") },
                { configurable: { session: deniedSession } },
            ),
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain("Permission denied");
    });
});
