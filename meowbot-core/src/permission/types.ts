/**
 * Permission system types
 *
 * Permission rules are dot-separated resource paths with optional wildcards:
 *   command.help              - exact match
 *   command.*                 - any single segment under command
 *   command.template.*        - any single segment under command.template
 *   command.template.**       - any number of segments under command.template
 *   !command.template.delete  - explicit deny
 *
 * Rules are space-separated in storage strings or arrays of strings.
 */

export interface IPermissionGroup {
    /** Unique group name, used as identifier */
    name: string;
    /** Human-readable description */
    description?: string;
    /** Permission rules (e.g. ["command.*", "!command.admin"]) */
    permissions: string[];
    /** Higher number = evaluated first when specificity ties */
    priority?: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface IUserPermissionProfile {
    /** Direct permission rules assigned to the user */
    permissions: string[];
    /** Names of permission groups the user belongs to */
    groups: string[];
}

export interface ParsedRule {
    /** Raw rule text */
    raw: string;
    /** true if this is a deny rule (starts with !) */
    deny: boolean;
    /** Pattern segments after stripping the deny prefix */
    pattern: string[];
}

export interface PermissionCheckResult {
    allowed: boolean;
    /** The rule that decided the result, if any */
    decidedBy?: string;
}
