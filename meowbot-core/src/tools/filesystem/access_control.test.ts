import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import { FsAccessControl, normalizeFsPath } from "./access_control.js";
import type { FsConfig } from "@meowbot/shared";

function control(config?: Partial<FsConfig>): FsAccessControl {
    return new FsAccessControl({ whitelist: [], blacklist: [], ...config });
}

describe("normalizeFsPath", () => {
    it("collapses .. and normalizes separators", () => {
        expect(normalizeFsPath("C:\\Windows\\..\\Windows\\System32\\")).toBe("c:/windows/system32");
    });

    it("strips the \\\\?\\ prefix", () => {
        expect(normalizeFsPath("\\\\?\\C:\\Windows\\System32")).toBe("c:/windows/system32");
    });

    it("lowercases drive letters and the rest stays as-is", () => {
        expect(normalizeFsPath("E:/Project/Meowbot/src/App.ts")).toBe("e:/project/meowbot/src/app.ts");
    });
});

describe("default blacklist (empty whitelist)", () => {
    const ac = control();

    it("allows normal files anywhere", () => {
        expect(ac.isAllowed("E:/project/meowbot/src/app.ts")).toBe(true);
        expect(ac.isAllowed("C:/Users/me/Documents/notes.md")).toBe(true);
    });

    it("denies .git directories", () => {
        expect(ac.isAllowed("E:/project/meowbot/.git/config")).toBe(false);
        expect(ac.isAllowed("E:/project/meowbot/.git")).toBe(false);
    });

    it("denies node_modules", () => {
        expect(ac.isAllowed("E:/project/meowbot/node_modules/x/index.js")).toBe(false);
    });

    it("denies the bot's own config dir", () => {
        expect(ac.isAllowed("E:/project/meowbot/meowbot-core/config/mcp-config.json")).toBe(false);
    });

    it("denies Windows system dirs", () => {
        expect(ac.isAllowed("C:/Windows/System32/drivers/etc/hosts")).toBe(false);
    });

    it("denies Windows dirs on any drive", () => {
        expect(ac.isAllowed("D:/Windows/System32/x")).toBe(false);
        expect(ac.isAllowed("C:/Windows/System32/x")).toBe(false);
    });

    it("denies home secrets", () => {
        expect(ac.isAllowed("C:/Users/me/.ssh/id_rsa")).toBe(false);
        expect(ac.isAllowed("C:/Users/me/.aws/credentials")).toBe(false);
    });

    it("is case-insensitive for matches", () => {
        expect(ac.isAllowed("c:/windows/system32/x")).toBe(false);
        expect(ac.isAllowed("C:/PROJECT/MEOWBOT/.GIT/HEAD")).toBe(false);
    });
});

describe("whitelist behavior", () => {
    it("default-deny when a whitelist is configured", () => {
        const ac = control({ whitelist: ["E:/project/meowbot/**"] });
        expect(ac.isAllowed("E:/project/meowbot/src/a.ts")).toBe(true);
        expect(ac.isAllowed("D:/other/secret.txt")).toBe(false);
    });

    it("blacklist wins over whitelist", () => {
        const ac = control({
            whitelist: ["**/project/**"],
            blacklist: ["**/project/secrets/**"],
        });
        expect(ac.isAllowed("E:/project/a.txt")).toBe(true);
        expect(ac.isAllowed("E:/project/secrets/a.txt")).toBe(false);
    });

    it("merges user blacklist with the default blacklist", () => {
        const ac = control({ blacklist: ["**/private/**"] });
        expect(ac.isAllowed("E:/project/meowbot/private/x.txt")).toBe(false);
        expect(ac.isAllowed("E:/project/meowbot/src/x.txt")).toBe(true);
        expect(ac.isAllowed("E:/project/meowbot/.git/x")).toBe(false); // default still applies
    });

    it("matches uppercase non-drive patterns case-insensitively on any platform", () => {
        const ac = control({ blacklist: ["**/Secret/**"] });
        expect(ac.isAllowed("E:/project/meowbot/Secret/a.txt")).toBe(false);
        expect(ac.isAllowed("e:/project/meowbot/secret/a.txt")).toBe(false);
        expect(ac.isAllowed("E:/project/meowbot/src/a.ts")).toBe(true);
    });
});

describe("filterEntries", () => {
    it("keeps only allowed entries", () => {
        const ac = control();
        const entries = [
            { path: "E:/project/meowbot/src/a.ts" },
            { path: "E:/project/meowbot/.git/HEAD" },
            { path: "E:/project/meowbot/node_modules/x.js" },
        ];
        expect(ac.filterEntries(entries)).toEqual([entries[0]]);
    });
});

describe("verify()", () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await mkdtemp(path.join(os.tmpdir(), "meowbot-ac-"));
    });

    afterEach(async () => {
        await rm(tmp, { recursive: true, force: true });
    });

    it("allows a nonexistent tail under an existing allowed directory", async () => {
        const ac = control();
        const res = await ac.verify(path.join(tmp, "new", "file.ts"));
        expect(res.ok).toBe(true);
    });

    it("denies paths whose real target is blacklisted (junction/symlink bypass)", async () => {
        await mkdir(path.join(tmp, ".git"), { recursive: true });
        const link = path.join(tmp, "link");
        try {
            await symlink(path.join(tmp, ".git"), link, process.platform === "win32" ? "junction" : "dir");
        } catch {
            return; // link creation not permitted in this environment — skip
        }

        const ac = control();
        const res = await ac.verify(path.join(link, "secret.txt"));
        expect(res.ok).toBe(false);
    });
});
