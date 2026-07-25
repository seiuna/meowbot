import { z } from "zod";

export const GlobalProxyConfigSchema = z.object({
    url: z.string(),
});
export type GlobalProxyConfig = z.infer<typeof GlobalProxyConfigSchema>;

export const NapLinkConfigSchema = z.object({
    url: z.string(),
    token: z.string().optional(),
    timeout: z.number().optional(),
    napcat_path: z.string(),
    pingInterval: z.number().optional(),
    heartbeatAction: z.object({
        action: z.string(),
        params: z.object({})
    }).optional(),
});
export type NapLinkConfig = z.infer<typeof NapLinkConfigSchema>;

export const LlmChatConfigSchema = z.object({
    executorId: z.string(),
    plannerId: z.string(),
    intentId: z.string(),
    ragId: z.string(),
    rewriteId: z.string(),
    defaults: z.object({
        temperature: z.number().optional(),
        maxRetries: z.number().optional(),
        disableThinking: z.boolean().optional(),
    }),
});
export type LlmChatConfig = z.infer<typeof LlmChatConfigSchema>;

export const LlmEmbeddingsConfigSchema = z.object({
    embeddingsId: z.string(),
});
export type LlmEmbeddingsConfig = z.infer<typeof LlmEmbeddingsConfigSchema>;

export const RagVectorStoreConfigSchema = z.object({
    provider: z.enum(["memory", "chroma"]),
    chromaUrl: z.string().optional(),
    topK: z.number().optional(),
    collectionName: z.string().optional(),
});
export type RagVectorStoreConfig = z.infer<typeof RagVectorStoreConfigSchema>;

export const BotInfoSchema = z.object({
    qq: z.string().regex(/^\d+$/, "QQ 号码必须全为数字"),
    master_qq: z.string().regex(/^\d+$/, "主控 QQ 号码必须全为数字"),
    name: z.string().min(1, "机器人名称不能为空"),
    master_name: z.string().min(1, "主控名称不能为空"),
});
export type BotInfo = z.infer<typeof BotInfoSchema>;

/**
 * 全局工具配置
 */
export const ToolsGlobalConfigSchema = z.object({
    max_image_size: z.number().int().min(1024).default(1024 * 1024),
});

export type ToolsGlobalConfig = z.infer<typeof ToolsGlobalConfigSchema>;

export const MongoDBConfigSchema = z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    username: z.string().optional(),
    password: z.string().optional(),
    authSource: z.string().optional(),
    useReplicaSet: z.boolean().optional(),
    replicaSetName: z.string().optional(),
});
export type MongoDBConfig = z.infer<typeof MongoDBConfigSchema>;

export const VendorSchema = z.enum(["openai", "openai_compatible", "google", "deepseek"]);
export type Vendor = z.infer<typeof VendorSchema>;

export const ModelCapabilitySchema = z.union([z.enum(["vision", "audio", "tts", "tools"]), z.string()]);
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

export const ProviderConfigSchema = z.object({
    vendor: VendorSchema,
    apiKey: z.string(),
    baseURL: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProvidersConfigSchema = z.record(z.string(), ProviderConfigSchema);
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

export const ModelOptionsSchema = z.object({
    model: z.string(),
    temperature: z.number().optional(),
    maxRetries: z.number().optional(),
    modelKwargs: z.record(z.string(), z.unknown()).optional(),
    disableThinking: z.boolean().optional(),
    capabilities: z.array(ModelCapabilitySchema).optional(),
});
export type ModelOptions = z.infer<typeof ModelOptionsSchema>;

export const ChatModelConfigSchema = z.object({
    providerName: z.string(),
    options: ModelOptionsSchema,
});
export type ChatModelConfig = z.infer<typeof ChatModelConfigSchema>;

export const ChatModelsConfigSchema = z.record(z.string(), ChatModelConfigSchema);
export type ChatModelsConfig = z.infer<typeof ChatModelsConfigSchema>;

export const EmbeddingsOptionsSchema = z.object({
    model: z.string(),
});
export type EmbeddingsOptions = z.infer<typeof EmbeddingsOptionsSchema>;

export const EmbeddingsModelConfigSchema = z.object({
    providerName: z.string(),
    options: EmbeddingsOptionsSchema,
});
export type EmbeddingsModelConfig = z.infer<typeof EmbeddingsModelConfigSchema>;

export const EmbeddingsModelsConfigSchema = z.record(z.string(), EmbeddingsModelConfigSchema);
export type EmbeddingsModelsConfig = z.infer<typeof EmbeddingsModelsConfigSchema>;

export const TimeoutsConfigSchema = z.object({
    NETWORK_REQUEST: z.number(),
    TOOL_EXECUTION: z.number(),
    SESSION_LOCK: z.number(),
    DEBOUNCE_DELAY: z.number(),
    DEBOUNCE_MAX_DELAY: z.number(),
    MODEL_INFERENCE: z.number(),
    RAG_QUERY: z.number(),
});
export type TimeoutsConfig = z.infer<typeof TimeoutsConfigSchema>;

export const UserProfileDefaultsSchema = z.object({
    /** Whether to inject profile info into HumanMessage (warmth/tags/summary) */
    promptInjection: z.boolean(),
    /** Default warmth for brand-new users (0-100) */
    defaultWarmth: z.number().min(0).max(100),
});
export type UserProfileDefaults = z.infer<typeof UserProfileDefaultsSchema>;
