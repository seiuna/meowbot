/**
 * Simple async mutex for serializing concurrent operations per key.
 *
 * Usage:
 *   const mutex = new AsyncKeyedMutex();
 *   await mutex.acquire("thread-123", async () => {
 *       // critical section
 *   });
 */

export class AsyncKeyedMutex {
    private locks = new Map<string, Promise<void>>();

    /**
     * Acquire the lock for the given key, run the callback, and release.
     * Ensures only one callback runs at a time per key.
     */
    async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.locks.get(key) ?? Promise.resolve();
        let release: () => void;
        const next = new Promise<void>(resolve => { release = resolve; });
        this.locks.set(key, prev.then(() => next));

        await prev;
        try {
            return await fn();
        } finally {
            release!();
            // Clean up if no one is waiting
            if (this.locks.get(key) === next) {
                this.locks.delete(key);
            }
        }
    }

    /** Check if a key currently has pending operations. */
    isLocked(key: string): boolean {
        return this.locks.has(key);
    }

    /** Number of keys with pending operations. */
    get size(): number {
        return this.locks.size;
    }
}
