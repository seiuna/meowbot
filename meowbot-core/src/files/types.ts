/**
 * FileService types
 *
 * Unified file access layer for adapter files and workspace files.
 *
 * fileId schemes:
 *   file_<uuid>    — adapter files registered via FileService.register()
 *   ws/<wsId>/<path> — workspace files, deterministically resolved from path
 */

/**
 * Metadata for a registered file.
 */
export interface FileMeta {
    /** Unique file identifier */
    fileId: string;
    /** Original file name */
    name: string;
    /** File size in bytes (0 if unknown) */
    size: number;
    /** MIME type (e.g. "image/png", "application/octet-stream") */
    mimeType: string;
    /** Source type */
    source: "adapter" | "workspace";
    /** Registration timestamp */
    createdAt: Date;
}
