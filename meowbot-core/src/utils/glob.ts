/**
 * Simple glob → RegExp converter.
 *
 * Supports: ** (zero or more path segments), * (single segment), ? (single char),
 * {a,b} (alternation). With `caseInsensitive`, the glob is lowercased and the
 * resulting RegExp is case-insensitive.
 *
 * Originally extracted from `workspace/workspace_tools.ts` so that the Workspace
 * tools and the FileSystem tools share identical pattern semantics.
 */
export function globToRegex(glob: string, caseInsensitive = false): RegExp {
    if (caseInsensitive) glob = glob.toLowerCase();
    let pattern = "";
    let i = 0;

    while (i < glob.length) {
        const ch = glob[i];

        if (ch === "*" && glob[i + 1] === "*") {
            // ** matches zero or more path segments. When it follows a '/',
            // the slash is consumed and the group becomes optional, so that
            // e.g. `a/**/b` also matches `a/b` and `dir/**` matches `dir`.
            if (pattern.endsWith("/")) {
                pattern = pattern.slice(0, -1); // remove the '/'
                pattern += "(?:/.*)?";
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
