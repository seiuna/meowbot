/**
 * PermissionManager
 *
 * Manages permission groups and user permission profiles.
 * Integrates with UserProfileManager for user-level data.
 */

import {
    IPermissionGroup,
    IUserPermissionProfile,
} from "./types.js";
import { PermissionGroupModel } from "../database/models.js";
import { getUserProfileManager } from "../social/user_profile_manager.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("PermissionManager");

export class PermissionManager {
    private static instance: PermissionManager;
    private groupCache: Map<string, IPermissionGroup> = new Map();
    private groupCacheValid = false;

    private constructor() {}

    public static getInstance(): PermissionManager {
        if (!PermissionManager.instance) {
            PermissionManager.instance = new PermissionManager();
        }
        return PermissionManager.instance;
    }

    public static resetInstance(): void {
        PermissionManager.instance = undefined as unknown as PermissionManager;
    }

    // ── Group CRUD ──

    /**
     * Create or fully replace a permission group.
     */
    public async upsertGroup(
        name: string,
        permissions: string[],
        description?: string,
        priority?: number
    ): Promise<IPermissionGroup> {
        const doc = await PermissionGroupModel.findOneAndUpdate(
            { name },
            {
                $set: {
                    name,
                    permissions,
                    description,
                    priority,
                    updatedAt: new Date(),
                },
            },
            {
                upsert: true,
                new: true,
                lean: true,
            }
        );

        this.invalidateGroupCache();
        logger.info(`Upserted permission group: ${name}`);
        return doc as unknown as IPermissionGroup;
    }

    /**
     * Delete a permission group and remove it from all users.
     */
    public async deleteGroup(name: string): Promise<boolean> {
        const result = await PermissionGroupModel.deleteOne({ name });
        if (result.deletedCount > 0) {
            const profileManager = getUserProfileManager();
            // Use the underlying model update to avoid one-by-one fetch
            const UserProfileModel = (await import("../database/models.js")).UserProfileModel;
            await UserProfileModel.updateMany(
                { permissionGroups: name },
                { $pull: { permissionGroups: name } }
            );
            this.invalidateGroupCache();
            logger.info(`Deleted permission group: ${name}`);
            return true;
        }
        return false;
    }

    /**
     * Get a single group by name.
     */
    public async getGroup(name: string): Promise<IPermissionGroup | null> {
        const doc = await PermissionGroupModel.findOne({ name }).lean();
        return doc as unknown as IPermissionGroup | null;
    }

    /**
     * List all groups.
     */
    public async listGroups(): Promise<IPermissionGroup[]> {
        const docs = await PermissionGroupModel.find().sort({ name: 1 }).lean();
        return docs as unknown as IPermissionGroup[];
    }

    /**
     * Load all groups into memory for fast rule resolution.
     */
    public async loadAllGroups(): Promise<Map<string, IPermissionGroup>> {
        if (this.groupCacheValid) {
            return new Map(this.groupCache);
        }

        const groups = await this.listGroups();
        this.groupCache.clear();
        for (const group of groups) {
            this.groupCache.set(group.name, group);
        }
        this.groupCacheValid = true;
        return new Map(this.groupCache);
    }

    public invalidateGroupCache(): void {
        this.groupCache.clear();
        this.groupCacheValid = false;
    }

    // ── User Permission Profile ──

    /**
     * Get a user's permission profile (direct rules + group memberships).
     */
    public async getUserPermissionProfile(userId: string): Promise<IUserPermissionProfile> {
        const profileManager = getUserProfileManager();
        const profile = await profileManager.getOrCreateProfile(userId);
        return {
            permissions: profile.permissions ?? [],
            groups: profile.permissionGroups ?? [],
        };
    }

    /**
     * Set a user's direct permission rules.
     */
    public async setUserPermissions(userId: string, permissions: string[]): Promise<boolean> {
        const profileManager = getUserProfileManager();
        const updated = await profileManager.updateProfile(userId, { permissions });
        if (updated) {
            logger.info(`Updated permissions for user: ${userId}`);
            return true;
        }
        return false;
    }

    /**
     * Set a user's permission groups.
     */
    public async setUserGroups(userId: string, groupNames: string[]): Promise<boolean> {
        const profileManager = getUserProfileManager();
        const updated = await profileManager.updateProfile(userId, { permissionGroups: groupNames });
        if (updated) {
            logger.info(`Updated permission groups for user: ${userId}`);
            return true;
        }
        return false;
    }

    /**
     * Add a user to a permission group.
     */
    public async addUserToGroup(userId: string, groupName: string): Promise<boolean> {
        // Validate that the group exists
        const existingGroup = await this.getGroup(groupName);
        if (!existingGroup) {
            logger.warn(`Cannot add user ${userId} to non-existent group: ${groupName}`);
            return false;
        }

        const profileManager = getUserProfileManager();
        const UserProfileModel = (await import("../database/models.js")).UserProfileModel;
        const result = await UserProfileModel.findOneAndUpdate(
            { userId },
            { $addToSet: { permissionGroups: groupName } },
            { new: true, upsert: true, lean: true }
        );
        if (result) {
            profileManager.invalidateCache(userId);
            logger.info(`Added user ${userId} to group ${groupName}`);
            return true;
        }
        return false;
    }

    /**
     * Remove a user from a permission group.
     */
    public async removeUserFromGroup(userId: string, groupName: string): Promise<boolean> {
        const profileManager = getUserProfileManager();
        const UserProfileModel = (await import("../database/models.js")).UserProfileModel;
        const result = await UserProfileModel.findOneAndUpdate(
            { userId },
            { $pull: { permissionGroups: groupName } },
            { new: true, lean: true }
        );
        if (result) {
            profileManager.invalidateCache(userId);
            logger.info(`Removed user ${userId} from group ${groupName}`);
            return true;
        }
        return false;
    }

    /**
     * Resolve the full list of effective permission rules for a user.
     * Combines direct rules with all group rules, sorted by group priority
     * (higher priority groups evaluated first). Direct user permissions always
     * come first.
     */
    public async resolveEffectiveRules(userId: string): Promise<string[]> {
        const profile = await this.getUserPermissionProfile(userId);
        const rules: string[] = [...profile.permissions];

        if (profile.groups.length > 0) {
            const groups = await this.loadAllGroups();

            // Collect groups with their priorities, then sort (higher priority first)
            const resolvedGroups: { group: IPermissionGroup; priority: number }[] = [];
            for (const groupName of profile.groups) {
                const group = groups.get(groupName);
                if (group) {
                    resolvedGroups.push({ group, priority: group.priority ?? 0 });
                } else {
                    logger.warn(`User ${userId} references missing permission group: ${groupName}`);
                }
            }

            // Sort by priority descending (higher priority = evaluated first in permission resolution)
            resolvedGroups.sort((a, b) => b.priority - a.priority);

            for (const { group } of resolvedGroups) {
                rules.push(...group.permissions);
            }
        }

        return rules;
    }
}

export function getPermissionManager(): PermissionManager {
    return PermissionManager.getInstance();
}
