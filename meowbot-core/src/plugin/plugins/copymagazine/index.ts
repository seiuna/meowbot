import { Plugin } from "../../index.js";
import { Command } from "../../../command/command.js";
import { SessionContext } from "@meowbot/gateway/index.js";
import { BaseFile } from "@meowbot/gateway/adapters/types";
import { getLogger } from "@meowbot/utils/logs";
import { ZipArchive } from "archiver";
import { getFileService } from "../../../files/index.js";

const logger = getLogger("CopyMagazinePlugin");


function extractWebP(buffer: Buffer): Buffer[] {
    const totalLen = buffer.length;
    const images: Buffer[] = [];
    let offset = 0;

    while (offset + 12 <= totalLen) {
        if (
            buffer[offset] === 0x52 &&
            buffer[offset + 1] === 0x49 &&
            buffer[offset + 2] === 0x46 &&
            buffer[offset + 3] === 0x46
        ) {
            const chunkSize = buffer.readUInt32LE(offset + 4);
            if (
                offset + 8 + 4 <= totalLen &&
                buffer[offset + 8] === 0x57 &&
                buffer[offset + 9] === 0x45 &&
                buffer[offset + 10] === 0x42 &&
                buffer[offset + 11] === 0x50
            ) {
                const webpSize = chunkSize + 8;
                if (offset + webpSize <= totalLen) {
                    const webpData = buffer.subarray(offset, offset + webpSize);
                    images.push(Buffer.from(webpData));
                    offset += webpSize;
                    continue;
                }
            }
        }
        offset++;
    }

    return images;
}

async function createZipArchive(files: { name: string; data: Buffer }[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const archive = new ZipArchive({ zlib: { level: 9 } });

        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("end", () => resolve(Buffer.concat(chunks)));
        archive.on("error", reject);

        for (const file of files) {
            archive.append(file.data, { name: file.name });
        }

        archive.finalize();
    });
}

export default class CopyMagazinePlugin extends Plugin {
    name = "copymagazine";
    version = "1.0.0";
    description = "A plugin for extracting WebP images from .copy files";

    async onLoad(): Promise<void> {
    }

    async onInit(context: any): Promise<void> {
        const { commandRegistry } = context;

        // Register using new command system
        commandRegistry.register("copymag", ["cm"])
            .desc("从 .copy 文件中提取 WebP 图片并打包成压缩包")
            .action(async (ctx: SessionContext<"command">, args: Record<string, any>) => {
                return await this.handleCopyMagCommand(ctx, args);
            });
    }

    async onUnload(): Promise<void> {
    }

    private findCopyFile(ctx: SessionContext<"command">): BaseFile | null {
        const currentFiles = ctx.event.extraPayload?.files;
        if (currentFiles && currentFiles.length > 0) {
            const copyFile = currentFiles.find((f: BaseFile) => {
                const name = f.getFileName();
                return name && name.endsWith(".copy");
            });
            if (copyFile) {
                return copyFile;
            }
        }

        let reference = ctx.event.reference;
        while (reference && reference.MessageEvent) {
            const refFiles = reference.MessageEvent.extraPayload?.files;
            if (refFiles && refFiles.length > 0) {
                const copyFile = refFiles.find((f: BaseFile) => {
                    const name = f.getFileName();
                    return name && name.endsWith(".copy");
                });
                if (copyFile) {
                    return copyFile;
                }
            }
            reference = reference.MessageEvent.reference;
        }

        return null;
    }

    private async handleCopyMagCommand(
        ctx: SessionContext<"command">,
        args: Record<string, any>
    ): Promise<string | void> {
        const copyFile = this.findCopyFile(ctx);

        if (!copyFile) {
            return "未找到 .copy 文件，请在发送命令时附带 .copy 文件，或引用包含 .copy 文件的消息";
        }

        try {
            const fileBuffer = await copyFile.toBuffer();
            logger.info(`Processing .copy file: ${copyFile.getFileName()} (${fileBuffer.length} bytes)`);
            const size: number = copyFile.getFileSize() as number;
            if(size > 26 * 1024 * 1024) {
                return "文件过大，无法处理，请确保 .copy 文件小于 26MB";
            }
            const webpImages = extractWebP(fileBuffer);

            if (webpImages.length === 0) {
                return "未在文件中找到任何图片";
            }

            logger.info(`Extracted ${webpImages.length} WebP images`);

            const zipFiles = webpImages.map((data, index) => ({
                name: `p_${index + 1}.webp`,
                data,
            }));

            const zipBuffer = await createZipArchive(zipFiles);
            logger.info(`Created zip archive: ${zipBuffer.length} bytes`);

            const outputName = copyFile.getFileName()?.replace(/\.copy$/i, ".zip") || args.filename || "copymag_images.zip";
            const fileId = getFileService().fromBuffer(zipBuffer, outputName);
            ctx.message([{ type: "file", data: fileId }]);
            return `已提取 ${webpImages.length} 张，打包为 ${outputName}`;

        } catch (error: any) {
            logger.error(`Failed to process .copy file: ${error.message}`);
            return `处理文件时出错: ${error.message}`;
        }
    }
}
