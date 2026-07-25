/**
 * Simple `${a.b}` template engine.
 * Replaces `${path.to.key}` placeholders with values from the data object.
 */

/**
 * Get a value from an object by dot-path.
 */
function getByPath(obj: Record<string, any>, path: string): string {
    const keys = path.split(".");
    let current: any = obj;
    for (const key of keys) {
        if (current == null || typeof current !== "object") return "";
        current = current[key];
    }
    return current != null ? String(current) : "";
}

/**
 * Render a template string with `${a.b}` placeholders.
 */
export function renderTemplate(template: string, data: Record<string, any>): string {
    return template.replace(/\$\{([a-zA-Z_][\w.]*)\}/g, (_, path) => {
        return getByPath(data, path);
    });
}
