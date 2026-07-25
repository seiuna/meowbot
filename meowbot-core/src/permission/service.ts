/**
 * PermissionService
 *
 * High-level API for checking whether a user is allowed to access a resource.
 * Reads the user's direct permissions plus permissions from their groups.
 */

import { PermissionCheckResult } from "./types.js";
import { evaluatePermission, hasExplicitPermission } from "./matcher.js";
import { PermissionManager } from "./manager.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("PermissionService");

export class PermissionService {
    private static instance: PermissionService;
    private manager: PermissionManager;

    private constructor(manager: PermissionManager) {
        this.manager = manager;
    }

    public static getInstance(manager?: PermissionManager): PermissionService {
        if (!PermissionService.instance) {
            if (!manager) {
                manager = PermissionManager.getInstance();
            }
            PermissionService.instance = new PermissionService(manager);
        }
        return PermissionService.instance;
    }

    /**
     * Check if a user is allowed to access a resource.
     */
    public async check(userId: string, resource: string): Promise<PermissionCheckResult> {
        try {
            const rules = await this.manager.resolveEffectiveRules(userId);
            const result = evaluatePermission(rules, resource);
            logger.debug(
                `Permission check for ${userId} on ${resource}: ${result.allowed}` +
                (result.decidedBy ? ` (decided by ${result.decidedBy})` : " (default deny)")
            );
            return result;
        } catch (error) {
            logger.error(`Permission check failed for ${userId} on ${resource}: ${error}`);
            // Fail closed: deny on error.
            return { allowed: false };
        }
    }

    /**
     * Convenience method that returns true/false.
     */
    public async isAllowed(userId: string, resource: string): Promise<boolean> {
        const result = await this.check(userId, resource);
        return result.allowed;
    }

    /**
     * Check whether a user has an **explicit allow** rule for a resource.
     * Unlike `isAllowed`, this does NOT default to true when no rules match.
     * Use for `.require()` checks where the user must actively possess the permission.
     */
    public async requireAllowed(userId: string, resource: string): Promise<boolean> {
        try {
            const rules = await this.manager.resolveEffectiveRules(userId);
            return hasExplicitPermission(rules, resource);
        } catch (error) {
            logger.error(`requireAllowed check failed for ${userId} on ${resource}: ${error}`);
            return false;
        }
    }

    /**
     * Reset the singleton instance. Useful for tests.
     */
    public static resetInstance(): void {
        PermissionService.instance = undefined as unknown as PermissionService;
    }
}

export function getPermissionService(): PermissionService {
    return PermissionService.getInstance();
}
