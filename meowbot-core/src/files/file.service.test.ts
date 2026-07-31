/**
 * FileService unit tests
 *
 * Tests for the unified file access layer including:
 *   - Registration (fromBuffer, fromBase64, register, fromUrl)
 *   - Retrieval (getBase64 with accept, getBuffer)
 *   - Availability check (isAvailable)
 *   - Meta / list / unregister / clear
 *   - Image conversion dispatch
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// Mock sharp to avoid native module resolution issues
vi.mock("sharp", () => {
    const mockInstance = {
        jpeg: vi.fn().mockReturnThis(),
        png: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        gif: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from("converted")),
    };
    return { default: vi.fn(() => mockInstance) };
});

import sharp from "sharp";
import { FileService } from "./file.service.js";

// ── Helpers ──

const PNG_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JPEG_DATA_URI = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4Q/SFhSRFJiMkVic4EzQjR0RSlFNkVUcCZS/9oADAMBAAIRAxEAPwC1//Z";

function makeTestFileService(): FileService {
    FileService.resetInstance();
    return FileService.getInstance();
}

// ── Suite ──

describe("FileService", () => {
    let fs: FileService;

    beforeEach(() => {
        fs = makeTestFileService();
    });

    afterEach(() => {
        FileService.resetInstance();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    // ═══════════════════════════════════════════════════════════
    //  Singleton
    // ═══════════════════════════════════════════════════════════

    describe("getInstance()", () => {
        it("should return the same instance", () => {
            const a = FileService.getInstance();
            const b = FileService.getInstance();
            expect(a).toBe(b);
        });

        it("resetInstance() should create a new instance", () => {
            const a = FileService.getInstance();
            FileService.resetInstance();
            const b = FileService.getInstance();
            expect(a).not.toBe(b);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Registration — fromBuffer / fromBase64 / register
    // ═══════════════════════════════════════════════════════════

    describe("fromBuffer()", () => {
        it("should register a buffer and return a fileId", () => {
            const buf = Buffer.from("hello");
            const fileId = fs.fromBuffer(buf, "test.txt");
            expect(fileId).toMatch(/^file_/);
        });

        it("should detect MIME from file extension", () => {
            const buf = Buffer.from("dummy");
            const fileId = fs.fromBuffer(buf, "photo.png");
            const meta = fs.getMeta(fileId);
            expect(meta?.mimeType).toBe("image/png");
        });

        it("should accept explicit MIME override", () => {
            const buf = Buffer.from("dummy");
            const fileId = fs.fromBuffer(buf, "file.bin", "image/webp");
            const meta = fs.getMeta(fileId);
            expect(meta?.mimeType).toBe("image/webp");
        });
    });

    describe("fromBase64()", () => {
        it("should register a data URI with parsed MIME", () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const meta = fs.getMeta(fileId);
            expect(meta?.mimeType).toBe("image/png");
        });

        it("should register raw base64 string", () => {
            const raw = "SGVsbG8="; // "Hello" in base64
            const fileId = fs.fromBase64(raw, "hello.txt");
            const meta = fs.getMeta(fileId);
            expect(meta?.mimeType).toBe("application/octet-stream");
        });

        it("should accept explicit MIME for raw base64", () => {
            const raw = "SGVsbG8=";
            const fileId = fs.fromBase64(raw, "hello.txt", "text/plain");
            const meta = fs.getMeta(fileId);
            expect(meta?.mimeType).toBe("text/plain");
        });
    });

    describe("register()", () => {
        it("should register a BaseFile-like object", () => {
            const baseFile = {
                getFileName: () => "test.png",
                getFileSize: () => 1024,
                toBuffer: async () => Buffer.from("fake-png"),
                toBase64: async () => PNG_DATA_URI,
            } as any;

            const fileId = fs.register(baseFile);
            expect(fileId).toMatch(/^file_/);
        });

        it("registerAll() should return a map of fileId → meta", () => {
            const files = [
                { getFileName: () => "a.png", getFileSize: () => 100, toBuffer: async () => Buffer.from("a"), toBase64: async () => PNG_DATA_URI },
                { getFileName: () => "b.png", getFileSize: () => 200, toBuffer: async () => Buffer.from("b"), toBase64: async () => PNG_DATA_URI },
            ] as any;

            const result = fs.registerAll(files);
            expect(result.size).toBe(2);
            const ids = [...result.keys()];
            expect(ids[0]).toMatch(/^file_/);
            expect(ids[1]).toMatch(/^file_/);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Retrieval — getBase64
    // ═══════════════════════════════════════════════════════════

    describe("getBase64()", () => {
        it("should return the original data URI when called without accept", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const result = await fs.getBase64(fileId);
            expect(result).toBe(PNG_DATA_URI);
        });

        it("should return as-is when original format is in accept list", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const result = await fs.getBase64(fileId, { accept: ["image/png", "image/jpeg"] });
            expect(result).toBe(PNG_DATA_URI);
        });

        it("should return null for unknown fileId", async () => {
            const result = await fs.getBase64("file_unknown123");
            expect(result).toBeNull();
        });

        it("should return null for unknown fileId scheme", async () => {
            const result = await fs.getBase64("unknown://scheme");
            expect(result).toBeNull();
        });
    });

    describe("getBase64() — conversion dispatch", () => {
        it("should call convertBase64 when original format not in accept list", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const spy = vi.spyOn(fs as any, "convertBase64").mockResolvedValue("data:image/jpeg;base64,converted");

            const result = await fs.getBase64(fileId, { accept: ["image/jpeg"] });

            expect(spy).toHaveBeenCalledOnce();
            expect(result).toBe("data:image/jpeg;base64,converted");
            spy.mockRestore();
        });

        it("should pass the first accepted format to convertBase64", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const spy = vi.spyOn(fs as any, "convertBase64").mockResolvedValue("data:image/webp;base64,conv");

            const result = await fs.getBase64(fileId, { accept: ["image/webp", "image/jpeg"] });

            expect(result).toBe("data:image/webp;base64,conv");
            expect(spy).toHaveBeenCalledWith(PNG_DATA_URI, "webp");
            spy.mockRestore();
        });

        it("should NOT call convertBase64 when original format is in accept list", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const spy = vi.spyOn(fs as any, "convertBase64").mockResolvedValue("data:image/png;base64,conv");

            const result = await fs.getBase64(fileId, { accept: ["image/png", "image/jpeg"] });

            expect(spy).not.toHaveBeenCalled();
            expect(result).toBe(PNG_DATA_URI);
            spy.mockRestore();
        });

        it("should NOT call convertBase64 when accept is empty array", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const spy = vi.spyOn(fs as any, "convertBase64").mockResolvedValue("data:image/png;base64,conv");

            const result = await fs.getBase64(fileId, { accept: [] });

            expect(spy).not.toHaveBeenCalled();
            expect(result).toBe(PNG_DATA_URI);
            spy.mockRestore();
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Retrieval — getBuffer
    // ═══════════════════════════════════════════════════════════

    describe("getBuffer()", () => {
        it("should return the buffer for a registered file", async () => {
            const buf = Buffer.from("test-content");
            const fileId = fs.fromBuffer(buf, "test.txt");
            const result = await fs.getBuffer(fileId);
            expect(result).toBeInstanceOf(Buffer);
            expect(result!.toString()).toBe("test-content");
        });

        it("should return null for unknown fileId", async () => {
            const result = await fs.getBuffer("file_notfound");
            expect(result).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  isAvailable
    // ═══════════════════════════════════════════════════════════

    describe("isAvailable()", () => {
        it("should return true for a registered file_* ID", async () => {
            const fileId = fs.fromBuffer(Buffer.from("x"), "x.txt");
            const available = await fs.isAvailable(fileId);
            expect(available).toBe(true);
        });

        it("should return false for an unregistered file_* ID", async () => {
            const available = await fs.isAvailable("file_nonexistent");
            expect(available).toBe(false);
        });

        it("should return false for unknown fileId scheme", async () => {
            const available = await fs.isAvailable("unknown://thing");
            expect(available).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Meta & listing
    // ═══════════════════════════════════════════════════════════

    describe("getMeta()", () => {
        it("should return metadata for a registered file", () => {
            const fileId = fs.fromBuffer(Buffer.from("data"), "doc.pdf");
            const meta = fs.getMeta(fileId);
            expect(meta).not.toBeNull();
            expect(meta!.fileId).toBe(fileId);
            expect(meta!.name).toBe("doc.pdf");
            expect(meta!.size).toBe(4);
            expect(meta!.mimeType).toBe("application/pdf");
            expect(meta!.source).toBe("adapter");
            expect(meta!.createdAt).toBeInstanceOf(Date);
        });

        it("should return null for unknown fileId", () => {
            expect(fs.getMeta("file_unknown")).toBeNull();
        });

        it("should return a copy, not the internal reference", () => {
            const fileId = fs.fromBuffer(Buffer.from("x"), "x.txt");
            const meta = fs.getMeta(fileId)!;
            meta.name = "hacked";
            const meta2 = fs.getMeta(fileId);
            expect(meta2!.name).toBe("x.txt");
        });
    });

    describe("listFiles()", () => {
        it("should list all registered files", () => {
            fs.fromBuffer(Buffer.from("a"), "a.txt");
            fs.fromBuffer(Buffer.from("bb"), "b.txt");
            expect(fs.listFiles()).toHaveLength(2);
        });

        it("should return empty array when no files registered", () => {
            expect(fs.listFiles()).toHaveLength(0);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Unregister & clear
    // ═══════════════════════════════════════════════════════════

    describe("unregister()", () => {
        it("should remove a file and return true", () => {
            const fileId = fs.fromBuffer(Buffer.from("x"), "x.txt");
            expect(fs.unregister(fileId)).toBe(true);
            expect(fs.getMeta(fileId)).toBeNull();
        });

        it("should return false for non-existent fileId", () => {
            expect(fs.unregister("file_nope")).toBe(false);
        });
    });

    describe("clear()", () => {
        it("should remove all registered files", () => {
            fs.fromBuffer(Buffer.from("a"), "a.txt");
            fs.fromBuffer(Buffer.from("b"), "b.txt");
            fs.clear();
            expect(fs.listFiles()).toHaveLength(0);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Edge cases
    // ═══════════════════════════════════════════════════════════

    describe("edge cases", () => {
        it("should handle empty buffer", () => {
            const fileId = fs.fromBuffer(Buffer.alloc(0), "empty.bin");
            const meta = fs.getMeta(fileId);
            expect(meta?.size).toBe(0);
        });

        it("should handle base64 of an empty string", () => {
            const fileId = fs.fromBase64("", "empty.txt", "text/plain");
            const meta = fs.getMeta(fileId);
            expect(meta?.size).toBe(0);
        });

        it("should handle file names without extension", () => {
            const fileId = fs.fromBuffer(Buffer.from("data"), "Makefile");
            const meta = fs.getMeta(fileId);
            expect(meta?.mimeType).toBe("application/octet-stream");
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Real conversion via sharp
    // ═══════════════════════════════════════════════════════════

    describe("getBase64() — real conversion", () => {
        it("should convert to the first accepted format (jpeg)", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const result = await fs.getBase64(fileId, { accept: ["image/jpeg"] });
            expect(result).toMatch(/^data:image\/jpeg;base64,/);
        });

        it("should convert to webp when accept lists webp first", async () => {
            const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
            const result = await fs.getBase64(fileId, { accept: ["image/webp", "image/jpeg"] });
            expect(result).toMatch(/^data:image\/webp;base64,/);
        });

        it("should return the original data URI when conversion fails", async () => {
            const sharpMock = sharp as unknown as Mock;
            const originalImpl = sharpMock.getMockImplementation();
            try {
                sharpMock.mockImplementation(() => ({
                    png: () => ({ toBuffer: vi.fn().mockRejectedValue(new Error("boom")) }),
                    jpeg: () => ({ toBuffer: vi.fn().mockRejectedValue(new Error("boom")) }),
                    webp: () => ({ toBuffer: vi.fn().mockRejectedValue(new Error("boom")) }),
                    gif: () => ({ toBuffer: vi.fn().mockRejectedValue(new Error("boom")) }),
                }));

                const fileId = fs.fromBase64(PNG_DATA_URI, "img.png");
                const result = await fs.getBase64(fileId, { accept: ["image/jpeg"] });

                expect(result).toBe(PNG_DATA_URI);
            } finally {
                if (originalImpl) sharpMock.mockImplementation(originalImpl);
            }
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  Registry meta with octet-stream MIME
    // ═══════════════════════════════════════════════════════════

    describe("getBase64() — registry meta with octet-stream mime", () => {
        it("should use the real MIME from the data URI for accept checks", async () => {
            const baseFile = {
                getFileName: () => "unknown",
                getFileSize: () => PNG_DATA_URI.length,
                toBuffer: async () => Buffer.from(PNG_DATA_URI.split(",")[1], "base64"),
                toBase64: async () => PNG_DATA_URI,
            } as any;

            const fileId = fs.register(baseFile);
            expect(fs.getMeta(fileId)?.mimeType).toBe("application/octet-stream");

            const spy = vi.spyOn(fs as any, "convertBase64");
            const result = await fs.getBase64(fileId, { accept: ["image/png", "image/jpeg"] });

            expect(result).toBe(PNG_DATA_URI);
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  URL downloads
    // ═══════════════════════════════════════════════════════════

    describe("getBase64() — URL downloads", () => {
        function stubFetch(ok: boolean = true, contentType: string = "image/png"): ReturnType<typeof vi.fn> {
            const fetchMock = vi.fn().mockResolvedValue({
                ok,
                headers: { get: () => contentType },
                arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            });
            vi.stubGlobal("fetch", fetchMock);
            return fetchMock;
        }

        it("should download a URL and cache the result", async () => {
            const fetchMock = stubFetch();

            const first = await fs.getBase64("https://example.com/a.png");
            const second = await fs.getBase64("https://example.com/a.png");

            expect(first).toMatch(/^data:image\/png;base64,/);
            expect(second).toBe(first);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("should send a User-Agent header when downloading", async () => {
            const fetchMock = stubFetch();

            await fs.getBase64("https://example.com/a.png");

            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("https://example.com/a.png");
            expect((init as RequestInit).headers).toMatchObject({
                "User-Agent": expect.stringContaining("MEOWBOT"),
            });
        });

        it("should return null when the URL responds with an error", async () => {
            stubFetch(false, "text/html");
            const result = await fs.getBase64("https://example.com/missing.png");
            expect(result).toBeNull();
        });

        it("should return null when the URL download throws", async () => {
            vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
            expect(await fs.getBase64("https://example.com/x.png")).toBeNull();
        });

        it("should re-download after the cache TTL expires", async () => {
            vi.useFakeTimers();
            const fetchMock = stubFetch();

            await fs.getBase64("https://example.com/a.png");
            vi.advanceTimersByTime(11 * 60 * 1000);
            await fs.getBase64("https://example.com/a.png");

            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("should evict the oldest entry when the cache is full", async () => {
            const fetchMock = stubFetch();

            for (let i = 0; i < 51; i++) {
                await fs.getBase64(`https://example.com/img-${i}.png`);
            }

            // The oldest entry was evicted, so fetching it again hits the network
            await fs.getBase64("https://example.com/img-0.png");
            expect(fetchMock).toHaveBeenCalledTimes(52);
        });

        it("should clear the download cache in clear()", async () => {
            const fetchMock = stubFetch();

            await fs.getBase64("https://example.com/a.png");
            fs.clear();
            await fs.getBase64("https://example.com/a.png");

            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });
});
