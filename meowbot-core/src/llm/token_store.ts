/**
 * TokenStore — MongoDB persistence for LLM token usage records.
 */

import mongoose from "mongoose";
import { getLogger } from "@meowbot/utils/logs";

const logger = getLogger("TokenStore");

export interface TokenRecord {
    model: string;
    model_name: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read: number;
    timestamp: Date;
}

export interface TokenStats {
    total_calls: number;
    total_input: number;
    total_output: number;
    total_cache_read: number;
    cache_hit_ratio: number;
}

const schema = new mongoose.Schema<TokenRecord>({
    model: { type: String, required: true, index: true },
    model_name: { type: String, default: "" },
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    cache_read: { type: Number, default: 0 },
    timestamp: { type: Date, default: () => new Date(), index: true },
});

const TokenModel = mongoose.model<TokenRecord>("TokenRecord", schema, "token_usage");

export class TokenStore {
    private static instance: TokenStore;

    static getInstance(): TokenStore {
        if (!TokenStore.instance) TokenStore.instance = new TokenStore();
        return TokenStore.instance;
    }

    async record(r: TokenRecord): Promise<void> {
        try {
            await TokenModel.create(r);
        } catch (err: any) {
            logger.warn("[TokenStore] record failed: " + (err.message ?? String(err)));
        }
    }

    async getStats(since?: Date): Promise<TokenStats & { byModel: Array<TokenStats & { model: string; model_name: string }> }> {
        const filter: any = {};
        if (since) filter.timestamp = { $gte: since };

        const [overall] = await TokenModel.aggregate([
            { $match: filter },
            { $group: { _id: null, total_calls: { $sum: 1 }, total_input: { $sum: "$input_tokens" }, total_output: { $sum: "$output_tokens" }, total_cache_read: { $sum: "$cache_read" } } },
        ]);

        const byModel = await TokenModel.aggregate([
            { $match: filter },
            { $group: { _id: "$model", model_name: { $first: "$model_name" }, total_calls: { $sum: 1 }, total_input: { $sum: "$input_tokens" }, total_output: { $sum: "$output_tokens" }, total_cache_read: { $sum: "$cache_read" } } },
            { $sort: { total_input: -1 } },
        ]);

        const o = overall ?? { total_calls: 0, total_input: 0, total_output: 0, total_cache_read: 0 };
        return {
            total_calls: o.total_calls ?? 0,
            total_input: o.total_input ?? 0,
            total_output: o.total_output ?? 0,
            total_cache_read: o.total_cache_read ?? 0,
            cache_hit_ratio: (o.total_input ?? 0) > 0 ? (o.total_cache_read ?? 0) / (o.total_input ?? 1) : 0,
            byModel: byModel.map((m: any) => ({
                model: m._id,
                model_name: m.model_name ?? "",
                total_calls: m.total_calls ?? 0,
                total_input: m.total_input ?? 0,
                total_output: m.total_output ?? 0,
                total_cache_read: m.total_cache_read ?? 0,
                cache_hit_ratio: (m.total_input ?? 0) > 0 ? (m.total_cache_read ?? 0) / m.total_input : 0,
            })),
        };
    }
}
