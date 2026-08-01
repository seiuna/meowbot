import {defineEnvToolWithThought} from "../tools";
import {RunnableConfig} from "@langchain/core/runnables";
import {createReactiveConfig} from "@meowbot/config";
import {HumanMessage} from "@langchain/core/messages";
import {Buffer} from "node:buffer";
import path from "node:path";
import {stat} from "node:fs/promises";
import {getLogger} from "@meowbot/utils/logs";
import {
    ToolsGlobalConfig,
    ToolsGlobalConfigSchema
} from "@meowbot/shared";
import {z} from "zod";
import { ScreenshotManager } from "../../image_generation/screenshot-manager.js";
import { getFileService, type FileService } from "../../files/index.js";
import { getFsAccessControl } from "../filesystem/access_control.js";
import { BuilderSource } from "../../image_generation/index.js";


// ── Card generation helper ──

interface StepItem {
    text: string;
    done: boolean;
}

interface TodoCardData {
    icon: string;
    title: string;
    total: number;
    completed: number;
    steps: StepItem[];
    footer: string;
}

interface TodoState {
    title: string;
    steps: StepItem[];
    createdAt: number;
}

let _screenshotManager: ScreenshotManager | null = null;

async function getScreenshotManager(): Promise<ScreenshotManager> {
    if (!_screenshotManager) {
        _screenshotManager = await ScreenshotManager.getInstance();
    }
    return _screenshotManager;
}

async function generateTodoCard(data: TodoCardData): Promise<string> {
    const manager = await getScreenshotManager();
    const page = await manager.createPage();
    try {
        const source = BuilderSource.fromTemplate("todo-card.html");
        const png = await manager.capture(page, source, {
            name: "todo-card",
            elementId: "#screenshot-target",
            data,
        });
        return "data:image/png;base64," + Buffer.from(png).toString("base64");
    } finally {
        await page.close().catch(() => {});
    }
}

function getTodoState(config?: RunnableConfig): TodoState | null {
    return (config?.configurable as any)?.todoState ?? null;
}

function setTodoState(config: RunnableConfig | undefined, state: TodoState): void {
    if (config?.configurable) {
        (config.configurable as any).todoState = state;
    }
}

// ── Tools ──

export const queryWeatherTool = defineEnvToolWithThought(
    {
        name: "query_weather",
        description: "Query the weather for a specified city.",
        schema: z.object({city: z.string().describe("The city or location to check the weather for.")})
    },
    async ({city}) => {
        try {
            const url = `https://wttr.in/${encodeURIComponent(city)}?format=%l:+%C,+%t+(体感+%f),+风速:+%w,+湿度:+%h`;

            const response = await fetch(url, {
                signal: AbortSignal.timeout(5000)
            });

            if (!response.ok) {
                return `查询天气失败，服务器状态码：${response.status}`;
            }

            return await response.text();

        } catch (error: any) {
            return `查询天气时发生网络异常: ${error.message}。`;
        }
    }
);



export const makePlanTool = defineEnvToolWithThought(
    {
        name: "create_todo_list",
        description:
            "Create a structured plan before tackling a complex task. " +
            "Break the work down into a clear, ordered list of actionable steps. " +
            "Call this BEFORE you start executing — it keeps you on track and prevents missed requirements. " +
            "This tool also renders a visual todo card for the user. " +
            "After creating the plan, immediately begin step 1 and call mark_step_complete after each step.",
        schema: z.object({
            task_analysis: z.string().describe(
                "A brief analysis of what the user needs. What is the goal? What are the constraints?"
            ),
            steps: z.array(z.string()).describe(
                "Ordered list of concrete, verifiable actions. Each step should be a single clear task."
            ),
        }),
    },
    async (input, runConfig) => {
        const n = input.steps.length;
        const stepItems: StepItem[] = input.steps.map(text => ({ text, done: false }));

        // Persist state so mark_step_complete can access it
        const state: TodoState = {
            title: input.task_analysis,
            steps: stepItems,
            createdAt: Date.now(),
        };
        setTodoState(runConfig, state);

        // Generate and send the card
        const session = (runConfig?.configurable as any)?.session;
        if (session) {
            try {
                const imageUrl = await generateTodoCard({
                    icon: "\u{1F4CB}",
                    title: state.title,
                    total: n,
                    completed: 0,
                    steps: stepItems,
                    footer: "Starting now... \u{1F43E}",
                });
                const fileId = getFileService().fromBase64(imageUrl, "todo-card.png");
                session.message([{ type: "image", data: fileId }]);
            } catch (err: any) {
                logger.warn("Failed to generate todo card: " + (err.message ?? String(err)));
            }
        }

        return JSON.stringify({
            ok: true,
            total_steps: n,
            message: "Plan created with " + n + " step" + (n > 1 ? "s" : "") + ". Proceed to step 1 now.",
        });
    },
);

export const markStepCompleteTool = defineEnvToolWithThought(
    {
        name: "mark_step_complete",
        description:
            "Record the completion of a step in your plan. Call this after finishing each step. " +
            "Summarize what was accomplished and state what you'll do next. " +
            "The visual todo card will be updated — completed steps are crossed out. " +
            "This keeps both you and the user in sync on progress.",
        schema: z.object({
            completed_step: z.string().describe(
                "The step you just finished. Must match the text from your todo list."
            ),
            result_summary: z.string().describe(
                "What was accomplished — key findings, outputs, or decisions made"
            ),
            next_action: z.string().describe(
                "The next step you will take. Reference the next item in your plan."
            ),
        }),
    },
    async (input, runConfig) => {
        const state = getTodoState(runConfig);
        if (!state) {
            return JSON.stringify({
                ok: false,
                error: "No active todo list. Create one with create_todo_list first.",
            });
        }

        // Find and mark the matching step as done
        const step = state.steps.find(s => s.text === input.completed_step);
        if (step) {
            step.done = true;
        }

        const completed = state.steps.filter(s => s.done).length;
        const total = state.steps.length;
        const allDone = completed === total;

        // Generate and send updated card
        const session = (runConfig?.configurable as any)?.session;
        if (session) {
            try {
                const imageUrl = await generateTodoCard({
                    icon: allDone ? "\u2705" : "\u{1F4CB}",
                    title: state.title,
                    total,
                    completed,
                    steps: state.steps,
                    footer: allDone ? "All done! \u{1F389}" : ("Next: " + input.next_action),
                });
                const fileId = getFileService().fromBase64(imageUrl, "todo-card.png");
                session.message([{ type: "image", data: fileId }]);
            } catch (err: any) {
                logger.warn("Failed to generate todo card: " + (err.message ?? String(err)));
            }
        }

        return JSON.stringify({
            ok: true,
            completed: input.completed_step,
            progress: completed + "/" + total,
            next: allDone ? "All steps complete! Call finish_task." : input.next_action,
        });
    },
);

// ── Decorate reply: runs LLM to attach metadata (reply, at, file, image) ──

// ── Decorate reply: set metadata that auto-applies to the NEXT outgoing message ──

export interface PendingDecoration {
    reply?: string;   // message ID to reply to
    at?: string[];    // user IDs to @mention
    file?: string[];  // FileService fileIds
    image?: string[]; // FileService fileIds (images)
}

/** Store pending decoration in runnable config. */
function setPendingDecoration(config: RunnableConfig | undefined, deco: PendingDecoration): void {
    if (config?.configurable) {
        (config.configurable as any).pendingDecoration = deco;
    }
}

/** Retrieve and consume pending decoration. Returns null if none set. */
export function consumePendingDecoration(config: RunnableConfig | undefined): PendingDecoration | null {
    if (!config?.configurable) return null;
    const deco = (config.configurable as any).pendingDecoration as PendingDecoration | undefined;
    if (deco) {
        delete (config.configurable as any).pendingDecoration;
    }
    return deco ?? null;
}

type AttachmentResolution = { ok: true; id: string } | { ok: false; error: string };

/**
 * Resolve a decoration attachment reference to a FileService fileId.
 *
 * Supports the existing schemes (`file_*`, `ws/*`, `http(s)://` URLs) and, new,
 * absolute filesystem paths (e.g. files created with the `write_file` tool).
 * Absolute paths must pass the filesystem access control (blacklist/whitelist)
 * before being registered with FileService.
 */
async function resolveAttachment(
    ref: string,
    fileService: FileService,
): Promise<AttachmentResolution> {
    if (
        ref.startsWith("file_") ||
        ref.startsWith("ws/") ||
        ref.startsWith("http://") ||
        ref.startsWith("https://")
    ) {
        return (await fileService.isAvailable(ref))
            ? { ok: true, id: ref }
            : { ok: false, error: `File not available: ${ref}` };
    }

    // Otherwise treat it as an absolute filesystem path.
    if (!path.isAbsolute(ref)) {
        return { ok: false, error: `Invalid file reference (expected fileId, URL, or absolute path): ${ref}` };
    }
    const verified = await getFsAccessControl().verify(ref);
    if (!verified.ok) return { ok: false, error: verified.error };
    try {
        const info = await stat(ref);
        if (!info.isFile()) return { ok: false, error: `Not a regular file: ${ref}` };
    } catch {
        return { ok: false, error: `File not found: ${ref}` };
    }
    try {
        const fileId = await fileService.fromLocalPath(ref);
        return { ok: true, id: fileId };
    } catch (error: any) {
        return { ok: false, error: `Failed to load file: ${error.message}` };
    }
}

export const decorateReplyTool = defineEnvToolWithThought(
    {
        name: "decorate_reply",
        description:
            "Set decorations (reply, at, file, image) that will be automatically " +
            "attached to your NEXT reply message. Call this BEFORE sending your final answer. " +
            "The decorations are consumed once — after the next reply, they are cleared.",
        schema: z.object({
            reply: z.string().optional().describe("Message ID to quote/reply to. Use the incoming message's ID."),
            at: z.array(z.string()).optional().describe("User IDs to @mention in group chats."),
            file: z.array(z.string()).optional().describe(
                "FileService fileIds (ws/... or file_...), HTTP URLs, or absolute filesystem paths to attach as files."
            ),
            image: z.array(z.string()).optional().describe(
                "FileService fileIds (ws/... or file_...), HTTP URLs, or absolute filesystem paths to attach as images."
            ),
        }),
    },
    async (input, runConfig) => {
        const deco: PendingDecoration = {};
        if (input.reply) deco.reply = input.reply;
        if (input.at && input.at.length > 0) deco.at = input.at;
        const fs = getFileService();
        if (input.file && input.file.length > 0) {
            const resolved = await Promise.all(input.file.map(ref => resolveAttachment(ref, fs)));
            const failure = resolved.find((r): r is { ok: false; error: string } => !r.ok);
            if (failure) {
                return JSON.stringify({ ok: false, error: failure.error, files: input.file });
            }
            deco.file = resolved.map(r => (r as { ok: true; id: string }).id);
        }
        if (input.image && input.image.length > 0) {
            const resolved = await Promise.all(input.image.map(ref => resolveAttachment(ref, fs)));
            const failure = resolved.find((r): r is { ok: false; error: string } => !r.ok);
            if (failure) {
                return JSON.stringify({ ok: false, error: failure.error, images: input.image });
            }
            deco.image = resolved.map(r => (r as { ok: true; id: string }).id);
        }

        if (Object.keys(deco).length === 0) {
            return JSON.stringify({ ok: true, decorated: false, message: "No decorations set." });
        }

        setPendingDecoration(runConfig, deco);
        // Also write directly to SessionContext for DefaultAgent to read
        const session = (runConfig?.configurable as any)?.session;
        if (session) {
            (session as any).pendingDecoration = deco;
        }

        return JSON.stringify({
            ok: true,
            decorated: true,
            pending: deco,
            message: "Decorations will be applied to your next reply.",
        });
    },
);

export const finishTaskTool = defineEnvToolWithThought(
    {
        name: "finish_task",
        description:
            "Signal that you have fully resolved ALL user requests and no further tools are needed. " +
            "Call this ONLY when every question has been answered and every task completed. " +
            "After calling this, you should deliver a final summary to the user.",
        schema: z.object({
            is_success: z.boolean().describe(
                "Whether all user requests were successfully completed"
            ),
        }),
    },
    async (input, runConfig) => {
        // Clear todo state on completion
        if (runConfig?.configurable) {
            (runConfig.configurable as any).todoState = null;
        }

        return JSON.stringify({
            ok: true,
            completed: input.is_success,
        });
    },
);

const logger=getLogger("ImageViewer")
const tools_config = createReactiveConfig<ToolsGlobalConfig>(
    "global:tools_config",
    {max_image_size: 1024 * 1024},
    ToolsGlobalConfigSchema
);

export const imageViewerTool = defineEnvToolWithThought(
    {
        name: "view_image",
        description: "当你获得图片的 URL 链接但无法直接看到内容时，使用此工具下载并解析图片。支持所有常见的图片格式。",
        schema: z.object({
            url: z.string().describe("需要查看的图片完整 URL 地址")
        })
    },
        async (input, runConfig?: RunnableConfig) => {
            const { url } = input;


            try {
                logger.info(`开始下载图片: ${url}`);
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MEOWBOT/1.0',
                    },
                    signal: AbortSignal.timeout(5000)
                });

                if (!response.ok) {
                    logger.info(`下载失败，状态码: ${response.status}`);
                    return `无法读取图片。服务器返回状态码: ${response.status}。请提示用户重新发送或检查链接。`;
                }

                let buffer: Buffer;
                const contentType = response.headers.get('content-type') || 'image/jpeg';
                const contentLength = response.headers.get('content-length');

                if (contentLength) {
                    const sizeInBytes = parseInt(contentLength, 10);
                    logger.info(`响应 Content-Length: ${(sizeInBytes / 1024).toFixed(2)} KB`);
                    if (sizeInBytes > tools_config.max_image_size) {
                        return `图片大小为 ${(sizeInBytes / 1024 / 1024).toFixed(2)}MB，超过了 ${(tools_config.max_image_size / 1024 / 1024).toFixed(2)}MB 的限制，无法处理。`;
                    }
                }

                const reader = response.body?.getReader();
                if (reader) {
                    const chunks: Uint8Array[] = [];
                    let totalSize = 0;
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            chunks.push(value);
                            totalSize += value.length;
                            if (totalSize > tools_config.max_image_size) {
                                logger.info(`拦截: 流式传输大小已超限`);
                                return `图片流式传输检测显示大小已超过 ${(tools_config.max_image_size / 1024 / 1024).toFixed(2)}MB，终止。`;
                            }
                        }
                    }
                    buffer = Buffer.concat(chunks);
                    logger.info(`图片下载完成 (分块流读取): ${(totalSize / 1024).toFixed(2)} KB`);
                } else {
                    const ab = await response.arrayBuffer();
                    buffer = Buffer.from(ab);
                    logger.info(`图片下载完成 (ArrayBuffer): ${(buffer.length / 1024).toFixed(2)} KB`);
                }

                logger.info(`[ImageViewer] 正在转换为 Base64，MIME 类型: ${contentType}`);
                const base64Data = `data:${contentType};base64,${buffer.toString('base64')}`;

                const state = runConfig?.configurable?.agentState;
                if (state && state.messages) {
                    state.messages.push(new HumanMessage({
                        content: [
                            { type: "text", text: `图片 ${url}` },
                            {
                                type: "image_url",
                                image_url: { url: base64Data }
                            }
                        ]
                    }));
                }

                return "图片已成功下载并转换以 Base64 的形式插入到当前上下文中，请结合图片内容进行分析和回答。";

            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.info(errorMsg)
                return `读取图片时发生错误: ${errorMsg}。`;
            }
    }
);
