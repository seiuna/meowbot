/**
 * BootstrapKeyManager
 *
 * Generates a one-time registration key at startup.
 * The key is printed to the console log.
 * Any user who calls /perm register <key> gets admin.permission assigned
 * and the key is consumed (one-time use).
 */

import { randomUUID } from "crypto";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("BootstrapKey");

export class BootstrapKeyManager {
    private static instance: BootstrapKeyManager;
    private key: string | null = null;
    private consumed = false;

    private constructor() {}

    public static getInstance(): BootstrapKeyManager {
        if (!BootstrapKeyManager.instance) {
            BootstrapKeyManager.instance = new BootstrapKeyManager();
        }
        return BootstrapKeyManager.instance;
    }

    /** Generate a new bootstrap key and log it prominently. */
    public generate(): string {
        // Use first 8 chars of a UUID for readability
        this.key = randomUUID().substring(0, 8);
        this.consumed = false;

        logger.info("=" .repeat(52));
        logger.info("  BOOTSTRAP REGISTRATION KEY");
        logger.info("  " + this.key);
        logger.info("  Use: /perm register " + this.key);
        logger.info("  This key grants admin.permission (one-time use).");
        logger.info("=" .repeat(52));

        console.log("");
        console.log("══════════════════════════════════════════════════");
        console.log("  BOOTSTRAP REGISTRATION KEY: " + this.key);
        console.log("  Use: /perm register " + this.key);
        console.log("  Grants admin.permission (one-time use).");
        console.log("══════════════════════════════════════════════════");
        console.log("");

        return this.key;
    }

    /**
     * Validate a registration attempt.
     * If valid, consumes the key and returns true.
     * Returns false if key is wrong or already consumed.
     */
    public validate(key: string): boolean {
        if (this.consumed) return false;
        if (!this.key) return false;
        if (key !== this.key) return false;

        this.consumed = true;
        logger.info("Bootstrap key consumed successfully");
        return true;
    }

    /** Whether the current key has been consumed. */
    public isConsumed(): boolean {
        return this.consumed;
    }

    /** Get the current key (or null if consumed). */
    public getKey(): string | null {
        return this.consumed ? null : this.key;
    }
}
