/**
 * Permission rule parsing and matching
 */

import { ParsedRule, PermissionCheckResult } from "./types.js";

const RULE_SEPARATOR = /\s+/;

/**
 * Parse a raw permission expression into individual rules.
 * Handles space-separated rules and trims empty entries.
 */
export function parsePermissionExpression(expression: string): string[] {
    return expression
        .split(RULE_SEPARATOR)
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
}

/**
 * Parse a single rule string into a structured object.
 */
export function parseRule(rule: string): ParsedRule {
    const trimmed = rule.trim();
    const deny = trimmed.startsWith("!");
    const patternText = deny ? trimmed.slice(1) : trimmed;
    return {
        raw: trimmed,
        deny,
        pattern: patternText.split(".").filter((s) => s.length > 0),
    };
}

/**
 * Check whether a permission pattern matches a resource path.
 *
 * Matching rules:
 *   - "*" matches exactly one segment.
 *   - "**" matches zero or more remaining segments (must be the last segment).
 *   - All other segments require exact equality.
 */
export function matchPattern(pattern: string[], resource: string[]): boolean {
    // A single "*" matches everything
    if (pattern.length === 1 && pattern[0] === "*") {
        return true;
    }

    let p = 0;
    let r = 0;

    while (p < pattern.length && r < resource.length) {
        const pat = pattern[p];

        if (pat === "**") {
            // ** at the end matches everything remaining.
            if (p === pattern.length - 1) {
                return true;
            }
            // Otherwise try every possible advance position.
            const remainingPattern = pattern.slice(p + 1);
            for (let advance = 0; advance <= resource.length - r; advance++) {
                if (matchPattern(remainingPattern, resource.slice(r + advance))) {
                    return true;
                }
            }
            return false;
        }

        if (pat !== "*" && pat !== resource[r]) {
            return false;
        }

        p++;
        r++;
    }

    // Fully consumed both sides, or pattern ends with ** matching empty remainder.
    if (p < pattern.length && pattern[p] === "**" && p === pattern.length - 1) {
        return true;
    }

    return p === pattern.length && r === resource.length;
}

/**
 * Check if a pattern matches as a prefix of the resource.
 * Used by deny rules to also block all sub-items.
 * e.g. pattern ["session"] → prefix match for ["session", "new"], ["session", "list"], etc.
 */
function isPrefixPattern(pattern: string[], resource: string[]): boolean {
    if (pattern.length >= resource.length) return false;
    return matchPattern(pattern, resource.slice(0, pattern.length));
}

/**
 * Evaluate a set of permission rules against a resource path.
 *
 * Resolution (deny-first):
 *   1. Scan ALL deny (!) rules first — if any matches (full or prefix), immediately denied.
 *   2. Scan ALL allow rules — if any matches, allowed.
 *   3. No match → default denied (deny by default).
 */
export function evaluatePermission(
    rules: string[],
    resource: string
): PermissionCheckResult {
    const resourceSegments = resource.split(".").filter((s) => s.length > 0);

    // 1. Deny-first: any matching ! rule blocks access immediately
    //    Matches both exact and prefix (so !session blocks session.new / session.list etc.)
    for (const ruleText of rules) {
        const rule = parseRule(ruleText);
        if (rule.deny && (
            matchPattern(rule.pattern, resourceSegments) ||
            isPrefixPattern(rule.pattern, resourceSegments)
        )) {
            return { allowed: false, decidedBy: rule.raw };
        }
    }

    // 2. Allow rules: first match grants access
    for (const ruleText of rules) {
        const rule = parseRule(ruleText);
        if (!rule.deny && matchPattern(rule.pattern, resourceSegments)) {
            return { allowed: true, decidedBy: rule.raw };
        }
    }

    // 3. No rule matches → deny by default
    return { allowed: false };
}

/**
 * Check whether a user has an **explicit allow** rule for a resource.
 *
 * Unlike `evaluatePermission` which defaults to denied when no rule matches,
 * this function requires at least one non-deny rule to positively match the resource.
 * If no rules match at all, access is denied.
 *
 * Use this for `.require()` permission checks where the intent is
 * "the user must have this permission granted" rather than "the user is not denied".
 */
export function hasExplicitPermission(
    rules: string[],
    resource: string
): boolean {
    const resourceSegments = resource.split(".").filter((s) => s.length > 0);

    for (const ruleText of rules) {
        const rule = parseRule(ruleText);
        if (!rule.deny && matchPattern(rule.pattern, resourceSegments)) {
            return true;
        }
    }

    return false;
}
