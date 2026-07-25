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
 * Score a pattern's specificity. Higher score = more specific.
 *
 * Scoring:
 *   - exact segment: +10
 *   - * segment:      +1
 *   - ** segment:     +0
 */
function specificityScore(pattern: string[]): number {
    return pattern.reduce((score, segment) => {
        if (segment === "**") return score;
        if (segment === "*") return score + 1;
        return score + 10;
    }, 0);
}

/**
 * Evaluate a set of permission rules against a resource path.
 *
 * Resolution:
 *   1. Consider only rules that match the resource.
 *   2. Pick the most specific matching rule(s).
 *   3. If both allow and deny exist at the same highest specificity, deny wins.
 *   4. If no rule matches, default to denied (deny by default).
 */
export function evaluatePermission(
    rules: string[],
    resource: string
): PermissionCheckResult {
    const resourceSegments = resource.split(".").filter((s) => s.length > 0);

    let bestScore = -1;
    const bestRules: ParsedRule[] = [];

    for (const ruleText of rules) {
        const rule = parseRule(ruleText);
        if (!matchPattern(rule.pattern, resourceSegments)) {
            continue;
        }

        const score = specificityScore(rule.pattern);
        if (score > bestScore) {
            bestScore = score;
            bestRules.length = 0;
            bestRules.push(rule);
        } else if (score === bestScore) {
            bestRules.push(rule);
        }
    }

    if (bestRules.length === 0) {
        return { allowed: false };
    }

    const hasDeny = bestRules.some((r) => r.deny);
    const decidedBy = bestRules.map((r) => r.raw).join(", ");
    return { allowed: !hasDeny, decidedBy };
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
