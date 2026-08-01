/**
 * Simple glob → RegExp converter.
 *
 * Supports: ** (any depth), * (single segment), ? (single char), {a,b} (alternation).
 *
 * Originally extracted from `workspace/workspace_tools.ts` so that the Workspace
 * tools and the FileSystem tools share identical pattern semantics.
 */
export function globToRegex(glob: string, caseInsensitive = false): RegExp {
    let pattern = "";
    let i = 0;

    while (i < glob.length) {
        const ch = glob[i];

        if (ch === "*" && glob[i + 1] === "*") {
            // ** matches any number of path segments (including zero)
            // Match the preceding / if present
            if (pattern.endsWith("\\/")) {
                pattern = pattern.slice(0, -2); // remove trailing \/
                pattern += "(?:\\/.*)?";
            } else {
                pattern += ".*";
            }
            i += 2;
            // Consume trailing /
            if (glob[i] === "/") i++;
        } else if (ch === "*") {
            // * matches anything except /
            pattern += "[^/]*";
            i++;
        } else if (ch === "?") {
            pattern += "[^/]";
            i++;
        } else if (ch === "{") {
            // Simple {a,b} alternation
            const close = glob.indexOf("}", i);
            if (close === -1) { pattern += "\\{"; i++; continue; }
            const inner = glob.slice(i + 1, close);
            const opts = inner.split(",").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            pattern += "(?:" + opts.join("|") + ")";
            i = close + 1;
        } else if ("().+^$|[]\\".includes(ch)) {
            pattern += "\\" + ch;
            i++;
        } else {
            pattern += ch;
            i++;
        }
    }

    return new RegExp("^" + pattern + "$", caseInsensitive ? "i" : "");
}
