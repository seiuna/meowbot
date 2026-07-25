/**
 * Unified application error class.
 *
 * Use this for all explicit error throws throughout the codebase
 * to ensure consistent error formatting and logging.
 *
 * Usage:
 *   throw new AppError("Permission denied", "PERMISSION_DENIED", { userId, perm });
 *   throw new AppError("File not found: " + path, "NOT_FOUND");
 */

export class AppError extends Error {
    public readonly code: string;
    public readonly context?: Record<string, unknown>;
    public readonly timestamp: Date;

    constructor(message: string, code: string, context?: Record<string, unknown>) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.context = context;
        this.timestamp = new Date();
        // Maintains proper stack trace in V8
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AppError);
        }
    }

    /** Format as a JSON-safe object for tool/command responses. */
    toJSON(): { ok: false; error: string; code: string; context?: Record<string, unknown> } {
        return {
            ok: false,
            error: this.message,
            code: this.code,
            ...(this.context ? { context: this.context } : {}),
        };
    }

    /** Convenience: wrap an unknown error into an AppError. */
    static from(original: unknown, code = "INTERNAL"): AppError {
        if (original instanceof AppError) return original;
        const message = original instanceof Error ? original.message : String(original);
        return new AppError(message, code);
    }
}
