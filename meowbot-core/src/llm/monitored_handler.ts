
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { LLMResult } from "@langchain/core/outputs";
import { getLogger } from "../utils/logs.js";
import { TokenStore } from "./token_store.js";

const logger = getLogger("MonitoredCallback");

export class MonitoredCallbackHandler extends BaseCallbackHandler {
    name = "MonitoredCallback";
    private modelId: string;
    private modelName: string;

    constructor(modelId: string, modelName: string) {
        super();
        this.modelId = modelId;
        this.modelName = modelName;
    }

    async handleLLMEnd(
        output: LLMResult,
        _runId: string,
        _parentRunId?: string | undefined,
    ): Promise<void> {
        const tokenUsage = (output.llmOutput as any)?.tokenUsage
            ?? (output.llmOutput as any)?.usage
            ?? {};

        const inputTokens = tokenUsage.promptTokens ?? tokenUsage.input_tokens ?? 0;
        const outputTokens = tokenUsage.completionTokens ?? tokenUsage.output_tokens ?? 0;
        const totalTokens = tokenUsage.totalTokens ?? tokenUsage.total_tokens ?? 0;

        if (inputTokens === 0 && outputTokens === 0) return;

        try {
            await TokenStore.getInstance().record({
                model: this.modelId,
                model_name: this.modelName,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                total_tokens: totalTokens,
                cache_read: 0,
                timestamp: new Date(),
            });
        } catch (err: any) {
            logger.warn("[MonitoredCallback] store failed: " + (err.message ?? String(err)));
        }
    }
}

