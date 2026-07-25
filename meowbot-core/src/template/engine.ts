
function getByPath(obj: any, path: string): any {
    const keys = path
        .replace(/\[([^\]]+)\]/g, '.$1') 
        .split('.')
        .filter(key => key.length > 0);

    let current = obj;
    for (const key of keys) {
        if (current == null || typeof current !== 'object') {
            return undefined; 
        }
        current = current[key];
    }
    return current; 
}


export function renderTemplate(
    template: string,
    data: Record<string, any>,
    options: {
        fallback?: string | null;
        escapeHtml?: boolean;
        stringifyObject?: 'json' | 'ignore';
    } = {}
): string {
    const {
        fallback = '',
        escapeHtml = false,
        stringifyObject = 'json',
    } = options;

    return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
        const trimmedPath = path.trim();
        const value = getByPath(data, trimmedPath);

        if (value === undefined || value === null) {
            return fallback === null ? match : fallback;
        }

        if (typeof value === 'object') {
            if (stringifyObject === 'ignore') {
                return match; 
            }
            try {
                return JSON.stringify(value);
            } catch {
                return match; 
            }
        }

        let result = String(value);

      

        return result;
    });
}