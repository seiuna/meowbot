/**
 * UserProfile Manager with caching
 * Provides getUserProfile with automatic cache expiration
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { UserProfileModel, IUserProfile } from "../database/models.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("UserProfileManager");

/** 用户默认值配置路径 */
const USER_DEFAULTS_PATH = "config/user-defaults.json";

/** 懒加载的用户默认值缓存 */
let cachedUserDefaults: Partial<IUserProfile> | null = null;

/**
 * 加载用户默认值配置
 */
async function loadUserDefaults(): Promise<Partial<IUserProfile>> {
    if (cachedUserDefaults) return cachedUserDefaults;

    try {
        if (existsSync(USER_DEFAULTS_PATH)) {
            const raw = await readFile(USER_DEFAULTS_PATH, "utf-8");
            cachedUserDefaults = JSON.parse(raw) as Partial<IUserProfile>;
            logger.info(`Loaded user defaults from ${USER_DEFAULTS_PATH}`);
        }
    } catch (error) {
        logger.warn(`Failed to load user defaults from ${USER_DEFAULTS_PATH}: ${error}`);
    }

    // Fallback: empty defaults
    if (!cachedUserDefaults) {
        cachedUserDefaults = {
            permissions: [],
            permissionGroups: [],
            tags: [],
        };
    }

    return cachedUserDefaults;
}

/** Cache entry with expiration */
interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

export class UserProfileManager {
    private static instance: UserProfileManager;

    /** In-memory cache: userId -> CacheEntry */
    private cache: Map<string, CacheEntry<IUserProfile>> = new Map();

    /** Default cache TTL: 5 minutes */
    private readonly DEFAULT_TTL_MS = 5 * 60 * 1000;

    /** Cleanup interval: 1 minute */
    private readonly CLEANUP_INTERVAL_MS = 60 * 1000;

    private cleanupTimer: NodeJS.Timeout | null = null;

    private constructor() {
        this.startCleanupTimer();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): UserProfileManager {
        if (!UserProfileManager.instance) {
            UserProfileManager.instance = new UserProfileManager();
        }
        return UserProfileManager.instance;
    }

    /**
     * Start periodic cleanup timer
     */
    private startCleanupTimer(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredEntries();
        }, this.CLEANUP_INTERVAL_MS);

        // Prevent timer from keeping process alive
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    /**
     * Remove expired cache entries
     */
    private cleanupExpiredEntries(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [userId, entry] of this.cache.entries()) {
            if (now >= entry.expiresAt) {
                this.cache.delete(userId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.debug(`Cleaned ${cleaned} expired cache entries`);
        }
    }

    /**
     * Get from cache if valid
     */
    private getFromCache(userId: string): IUserProfile | null {
        const entry = this.cache.get(userId);
        if (!entry) {
            return null;
        }

        // Check if expired
        if (Date.now() >= entry.expiresAt) {
            this.cache.delete(userId);
            return null;
        }

        return entry.data;
    }

    /**
     * Set cache entry
     */
    private setCache(userId: string, profile: IUserProfile, ttlMs?: number): void {
        const ttl = ttlMs ?? this.DEFAULT_TTL_MS;
        this.cache.set(userId, {
            data: profile,
            expiresAt: Date.now() + ttl,
        });
    }

    /**
     * Invalidate cache for a user
     */
    public invalidateCache(userId: string): void {
        this.cache.delete(userId);
        logger.debug(`Cache invalidated for user: ${userId}`);
    }

    /**
     * Clear all cache
     */
    public clearCache(): void {
        const size = this.cache.size;
        this.cache.clear();
        logger.debug(`Cache cleared: ${size} entries removed`);
    }

    /**
     * Get user profile with caching
     * @param userId - User ID
     * @param forceRefresh - Force refresh from database
     * @returns User profile or null if not found
     */
    public async getUserProfile(userId: string, forceRefresh: boolean = false): Promise<IUserProfile | null> {
        // Check cache first (unless force refresh)
        if (!forceRefresh) {
            const cached = this.getFromCache(userId);
            if (cached) {
                logger.debug(`Cache hit for user: ${userId}`);
                return cached;
            }
        }

        // Fetch from database
        try {
            const profile = await UserProfileModel.findOne({ userId }).lean();

            if (profile) {
                // Store in cache
                this.setCache(userId, profile as unknown as IUserProfile);
                logger.debug(`Cached profile for user: ${userId}`);
            }

            return profile as unknown as IUserProfile | null;
        } catch (error) {
            logger.error(`Failed to get user profile: ${error}`);
            throw error;
        }
    }

    /**
     * Get or create user profile
     * @param userId - User ID
     * @param defaults - Default values for new profile (overrides config file defaults)
     * @returns User profile (existing or newly created)
     */
    public async getOrCreateProfile(
        userId: string,
        defaults?: Partial<IUserProfile>
    ): Promise<IUserProfile> {
        // Check cache first
        const cached = this.getFromCache(userId);
        if (cached) {
            return cached;
        }

        try {
            // Merge: explicit defaults > config file defaults
            const fileDefaults = await loadUserDefaults();
            const merged: Partial<IUserProfile> = {
                tags: defaults?.tags ?? fileDefaults.tags ?? [],
                summary: defaults?.summary ?? fileDefaults.summary ?? "",
                warmth: defaults?.warmth ?? fileDefaults.warmth ?? 0,
                trust: defaults?.trust ?? fileDefaults.trust ?? 0,
                sessions: defaults?.sessions ?? fileDefaults.sessions ?? [],
                permissions: defaults?.permissions ?? fileDefaults.permissions ?? [],
                permissionGroups: defaults?.permissionGroups ?? fileDefaults.permissionGroups ?? [],
            };
            // Try to find existing or create new
            const profile = await UserProfileModel.findOneAndUpdate(
                { userId },
                {
                    $setOnInsert: {
                        userId,
                        tags: merged.tags,
                        summary: merged.summary,
                        warmth: merged.warmth,
                        trust: merged.trust,
                        sessions: merged.sessions,
                        permissions: merged.permissions,
                        permissionGroups: merged.permissionGroups,
                        createdAt: new Date()},
                },
                {
                    upsert: true,
                    returnDocument: 'after',
                    lean: true,
                }
            );

            // Update cache
            this.setCache(userId, profile as unknown as IUserProfile);

            return profile as unknown as IUserProfile;
        } catch (error) {
            logger.error(`Failed to get or create user profile: ${error}`);
            throw error;
        }
    }

    /**
     * Update user profile
     * @param userId - User ID
     * @param updates - Fields to update
     * @returns Updated profile
     */
    public async updateProfile(
        userId: string,
        updates: Partial<Omit<IUserProfile, "userId" | "createdAt">>
    ): Promise<IUserProfile | null> {
        try {
            this.invalidateCache(userId);

            const profile = await UserProfileModel.findOneAndUpdate(
                { userId },
                { $set: updates },
                { returnDocument: 'after', upsert: true }
            );

            return profile as unknown as IUserProfile | null;
        } catch (error) {
            logger.error(`Failed to update user profile: ${error}`);
            throw error;
        }
    }

    /**
     * Update warmth with history tracking
     */
    public async updateWarmth(
        userId: string,
        newWarmth: number,
        reason: string
    ): Promise<IUserProfile | null> {
        try {
            // Remove cache to ensure fresh data on next get
            this.invalidateCache(userId);

            // Get current warmth for history
            const current = await this.getUserProfile(userId, true);
            const oldWarmth = current?.warmth ?? 0;

            const historyEntry = {
                from: oldWarmth,
                to: newWarmth,
                reason,
                timestamp: Date.now(),
            };

            const profile = await UserProfileModel.findOneAndUpdate(
                { userId },
                {
                    $set: {
                        warmth: newWarmth},
                    $push: {
                        warmthHistory: {
                            $each: [historyEntry],
                            $position: 0,
                            $slice: 50, // Keep last 50 entries
                        },
                    },
                },
                {
                    returnDocument: 'after',
                    lean: true,
                    upsert: true,
                }
            );

            return profile as unknown as IUserProfile;
        } catch (error) {
            logger.error(`Failed to update warmth: ${error}`);
            throw error;
        }
    }

    /**
     * Add session to user profile
     */
    public async addSession(
        userId: string,
        sessionId: string
    ): Promise<IUserProfile | null> {
        try {
            // Remove cache to ensure fresh data on next get
            this.invalidateCache(userId);

            const profile = await UserProfileModel.findOneAndUpdate(
                { userId },
                {
                    $addToSet: { sessions: sessionId },
                    $set: {},
                },
                {
                    returnDocument: 'after',
                    lean: true,
                    upsert: true,
                }
            );

            return profile as unknown as IUserProfile;
        } catch (error) {
            logger.error(`Failed to add session: ${error}`);
            throw error;
        }
    }

    /**
     * Remove session from user profile
     */
    public async removeSession(
        userId: string,
        sessionId: string
    ): Promise<IUserProfile | null> {
        try {
            // Remove cache to ensure fresh data on next get
            this.invalidateCache(userId);

            const profile = await UserProfileModel.findOneAndUpdate(
                { userId },
                {
                    $pull: { sessions: sessionId },
                    $set: {},
                },
                {
                    returnDocument: 'after',
                    lean: true,
                }
            );

            return profile as unknown as IUserProfile | null;
        } catch (error) {
            logger.error(`Failed to remove session: ${error}`);
            throw error;
        }
    }

    /**
     * Set selected agent for user
     */
    public async setAgent(
        userId: string,
        agentName: string | null
    ): Promise<IUserProfile | null> {
        try {
            // Remove cache to ensure fresh data on next get
            this.invalidateCache(userId);

            const profile = await UserProfileModel.findOneAndUpdate(
                { userId },
                {
                    $set: {
                        agent: agentName},
                },
                {
                    returnDocument: 'after',
                    lean: true,
                }
            );

            return profile as unknown as IUserProfile | null;
        } catch (error) {
            logger.error(`Failed to set agent: ${error}`);
            throw error;
        }
    }

    /**
     * Delete user profile
     */
    public async deleteProfile(userId: string): Promise<boolean> {
        try {
            const result = await UserProfileModel.deleteOne({ userId });

            // Remove from cache
            this.invalidateCache(userId);

            return result.deletedCount > 0;
        } catch (error) {
            logger.error(`Failed to delete user profile: ${error}`);
            throw error;
        }
    }

    /**
     * Get cache stats
     */
    public getCacheStats(): { size: number; entries: string[] } {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.keys()),
        };
    }

    /**
     * Cleanup resources
     */
    public destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.cache.clear();
    }
}

/**
 * Get the global UserProfileManager instance
 */
export function getUserProfileManager(): UserProfileManager {
    return UserProfileManager.getInstance();
}
