import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { createReactiveConfig } from "@meowbot/config";
import {
    Vendor,
    ModelCapability,
    ProviderConfig, ProvidersConfigSchema,
    ModelOptions, ChatModelsConfigSchema, ChatModelOverride,
    EmbeddingsOptions, EmbeddingsModelsConfigSchema,
} from "@meowbot/shared";
import { MonitoredCallbackHandler } from "./monitored_handler.js";
import {
    resolvePreset,
    resolveModel,
    listPresets as listBuiltinPresets,
    getDefaultModel,
    type PresetDef,
    type PresetModel,
} from "./presets.js";

// ── Internal helpers ──

/** Resolve a provider config to concrete vendor/baseURL via preset lookup. */
function resolveProvider(provider: ProviderConfig): { vendor: Vendor; apiKey: string; baseURL?: string; preset: PresetDef } {
    const preset = resolvePreset(provider.preset);
    if (!preset) {
        throw new Error(
            `Unknown preset "${provider.preset}". Available: ${listBuiltinPresets().join(", ")}`,
        );
    }

    return {
        vendor: provider.vendor ?? preset.vendor,
        apiKey: provider.apiKey,
        baseURL: provider.baseURL ?? (preset.baseURL || undefined),
        preset,
    };
}

// ── Default values ──

/** Default provider when nothing is configured — uses DeepSeek preset. */
const DEFAULT_PROVIDER: ProviderConfig = {
    preset: "deepseek",
    apiKey: "sk-xxxxxx",
};

/** Default chat_models config. */
const DEFAULT_CHAT_MODELS = {
    defaultModel: "deepseek-v4-flash",
} satisfies { defaultModel: string; overrides?: Record<string, ChatModelOverride> };

/** Default embeddings config. */
const DEFAULT_EMBEDDINGS = {
    embeddings: { providerName: "default", options: { model: "text-embedding-ada-002" } },
};

// ── Standard role configs ──

/** Default per-role options (merged on top of defaultModel). */
const ROLE_DEFAULTS: Record<string, Partial<ModelOptions>> = {
    executor:  { temperature: 0.7, disableThinking: false, capabilities: ["tools"] },
    intent:    { temperature: 0,   disableThinking: true,  capabilities: [] },
    planner:   { temperature: 0,   disableThinking: true,  capabilities: ["tools"] },
    filter:    { temperature: 0,   disableThinking: true,  capabilities: [] },
    rag:       { temperature: 0,   disableThinking: true,  capabilities: [] },
    rewrite:   { temperature: 0,   disableThinking: true,  capabilities: [] },
    compactor: { temperature: 0,   disableThinking: true,  capabilities: [] },
};

export class ModelRegistry {
    // ═══════════════════════════════════════════════════════════
    //  Reactive config stores
    // ═══════════════════════════════════════════════════════════

    public providers = createReactiveConfig<Record<string, ProviderConfig>>(
        "llm:providers",
        { "default": DEFAULT_PROVIDER },
        ProvidersConfigSchema,
    );

    public chatModels = createReactiveConfig<{ defaultModel: string; overrides?: Record<string, ChatModelOverride> }>(
        "llm:chat_models",
        DEFAULT_CHAT_MODELS,
        ChatModelsConfigSchema,
    );

    public embeddingsModels = createReactiveConfig<Record<string, { providerName: string; options: EmbeddingsOptions }>>(
        "llm:embeddings_models",
        DEFAULT_EMBEDDINGS,
        EmbeddingsModelsConfigSchema,
    );

    // ═══════════════════════════════════════════════════════════
    //  Instance caches
    // ═══════════════════════════════════════════════════════════

    private modelInstances = new Map<string, any>();
    private embeddingsInstances = new Map<string, any>();

    // ═══════════════════════════════════════════════════════════
    //  Model role resolution
    // ═══════════════════════════════════════════════════════════

    /** Get the effective ModelOptions for a given role, merging default + role defaults + overrides. */
    public getModelConfig(id: string): { providerName: string; options: ModelOptions } {
        const cfg = this.chatModels;
        const override: ChatModelOverride = cfg.overrides?.[id] ?? {};
        const roleDefault = ROLE_DEFAULTS[id] ?? {};

        const model = override.model ?? cfg.defaultModel;
        const providerName = override.providerName ?? "default";
        const temperature = override.temperature ?? roleDefault.temperature ?? 0;
        const maxRetries = override.maxRetries ?? roleDefault.maxRetries ?? 2;
        const disableThinking = override.disableThinking ?? roleDefault.disableThinking ?? true;
        const capabilities = override.capabilities ?? roleDefault.capabilities ?? [];
        const modelKwargs = override.modelKwargs ?? roleDefault.modelKwargs;

        return {
            providerName,
            options: {
                model,
                temperature,
                maxRetries,
                disableThinking,
                capabilities,
                ...(modelKwargs ? { modelKwargs } : {}),
            },
        };
    }

    /** Resolve model ID + provider to actual capabilities (from preset model definitions). */
    public getModelCapabilities(providerName: string, modelId: string): ModelCapability[] {
        try {
            const provider = resolveProvider(this.providers[providerName]);
            const model = resolveModel(provider.preset, modelId);
            return model?.capabilities ?? [];
        } catch {
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Model instantiation
    // ═══════════════════════════════════════════════════════════

    public async ensureModelsAvailable(requiredModels: string[]): Promise<void> {
        for (const modelId of requiredModels) {
            // Validate that the model can be resolved
            this.getModel(modelId);
        }
    }

    public getModel(id: string): ChatOpenAI {
        // Clear cache on config change by checking if cache is stale
        if (this.modelInstances.has(id)) {
            return this.modelInstances.get(id);
        }

        const modelConfig = this.getModelConfig(id);
        const providerRaw = this.providers[modelConfig.providerName];
        if (!providerRaw) {
            throw new Error(
                `Provider "${modelConfig.providerName}" not found. ` +
                `Available: ${Object.keys(this.providers).join(", ")}`,
            );
        }

        const provider = resolveProvider(providerRaw);
        const modelId = modelConfig.options.model;

        // Validate model exists in preset (unless custom models allowed)
        if (!resolveModel(provider.preset, modelId)) {
            throw new Error(
                `Model "${modelId}" is not in preset "${providerRaw.preset}". ` +
                `Available: ${provider.preset.models.map(m => m.id).join(", ")}`,
            );
        }

        const modelInstance = this.createChatModel({
            vendor: provider.vendor,
            apiKey: provider.apiKey,
            baseURL: provider.baseURL,
            model: modelId,
            temperature: modelConfig.options.temperature ?? 0.7,
            maxRetries: modelConfig.options.maxRetries ?? 2,
            modelKwargs: modelConfig.options.modelKwargs,
            disableThinking: modelConfig.options.disableThinking,
            modelId: id,
        });

        this.modelInstances.set(id, modelInstance);
        return Object.assign(modelInstance, { id }, {
            capabilities: modelConfig.options.capabilities,
        }) as unknown as ChatOpenAI;
    }

    // ═══════════════════════════════════════════════════════════
    //  Configuration helpers
    // ═══════════════════════════════════════════════════════════

    public addProvider(name: string, config: ProviderConfig): void {
        this.providers[name] = config;
        // Invalidate all cached instances (they may reference old provider)
        this.modelInstances.clear();
        this.embeddingsInstances.clear();
    }

    public addModel(id: string, providerName: string, options: ModelOptions): void {
        if (!this.chatModels.overrides) this.chatModels.overrides = {};
        this.chatModels.overrides[id] = {
            providerName,
            ...options,
        };
        this.modelInstances.delete(id);
    }

    /** List all available preset names. */
    public listPresets(): string[] {
        return listBuiltinPresets();
    }

    /** Get preset details (vendor, models, default baseURL). */
    public getPreset(name: string): PresetDef | undefined {
        return resolvePreset(name);
    }

    /** List all models available in a given provider's preset. */
    public listProviderModels(providerName: string): PresetModel[] {
        try {
            const provider = resolveProvider(this.providers[providerName]);
            return provider.preset.models;
        } catch {
            return [];
        }
    }

    /** Get the default model ID for a provider. */
    public getProviderDefaultModel(providerName: string): string | undefined {
        try {
            const provider = resolveProvider(this.providers[providerName]);
            return getDefaultModel(provider.preset);
        } catch {
            return undefined;
        }
    }

    /** Remove a model override (reverts to defaultModel for that role). */
    public removeModelOverride(id: string): void {
        if (this.chatModels.overrides) {
            delete this.chatModels.overrides[id];
        }
        this.modelInstances.delete(id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Embeddings
    // ═══════════════════════════════════════════════════════════

    public addEmbeddings(id: string, providerName: string, options: EmbeddingsOptions): void {
        this.embeddingsModels[id] = { providerName, options };
        this.embeddingsInstances.delete(id);
    }

    public getEmbeddings<T = any>(id: string): T {
        if (this.embeddingsInstances.has(id)) {
            return this.embeddingsInstances.get(id);
        }

        const modelConfig = this.embeddingsModels[id];
        if (!modelConfig) {
            throw new Error(`Embeddings with id "${id}" is not configured in embeddingsModels.`);
        }

        const providerRaw = this.providers[modelConfig.providerName];
        if (!providerRaw) {
            throw new Error(`Provider "${modelConfig.providerName}" has not been registered in providers.`);
        }

        const provider = resolveProvider(providerRaw);

        let embeddingsInstance;
        if (provider.vendor === "google") {
            embeddingsInstance = new GoogleGenerativeAIEmbeddings({
                model: modelConfig.options.model,
                apiKey: provider.apiKey,
            });
        } else {
            embeddingsInstance = new OpenAIEmbeddings({
                model: modelConfig.options.model,
                apiKey: provider.apiKey,
                configuration: provider.baseURL ? { baseURL: provider.baseURL } : undefined,
            });
        }

        this.embeddingsInstances.set(id, embeddingsInstance);
        return Object.assign(embeddingsInstance, { id }) as unknown as T;
    }

    // ═══════════════════════════════════════════════════════════
    //  Internal: model factory
    // ═══════════════════════════════════════════════════════════

    private createChatModel(params: {
        vendor: Vendor;
        apiKey: string;
        baseURL?: string;
        model: string;
        temperature: number;
        maxRetries: number;
        modelKwargs?: Record<string, unknown>;
        disableThinking?: boolean;
        modelId?: string;
    }) {
        const finalModelKwargs = params.modelKwargs ?? (params.disableThinking ? { thinking: { type: "disabled" } } : undefined);
        const handler = new MonitoredCallbackHandler(params.modelId ?? "unknown", params.model);

        switch (params.vendor) {
            case "google":
                return new ChatGoogleGenerativeAI({
                    model: params.model,
                    apiKey: params.apiKey,
                    temperature: params.temperature,
                    maxRetries: params.maxRetries,
                    callbacks: [handler],
                });
            case "deepseek":
                return new ChatDeepSeek({
                    model: params.model,
                    apiKey: params.apiKey,
                    temperature: params.temperature,
                    maxRetries: params.maxRetries,
                    modelKwargs: finalModelKwargs,
                    configuration: params.baseURL ? { baseURL: params.baseURL } : undefined,
                    callbacks: [handler],
                });
            case "openai":
            case "openai_compatible":
            default:
                return new ChatOpenAI({
                    streaming: true,
                    model: params.model,
                    apiKey: params.apiKey,
                    temperature: params.temperature,
                    maxRetries: params.maxRetries,
                    modelKwargs: finalModelKwargs,
                    configuration: params.baseURL ? { baseURL: params.baseURL } : undefined,
                });
        }
    }
}
