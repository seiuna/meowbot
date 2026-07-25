import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { createReactiveConfig } from "@meowbot/config";
import {
    Vendor,
    ModelCapability,
    ProviderConfig, ProvidersConfigSchema,
    ModelOptions, ChatModelsConfigSchema,
    EmbeddingsOptions, EmbeddingsModelsConfigSchema
} from "@meowbot/shared";
import { MonitoredCallbackHandler } from "./monitored_handler.js";

export class ModelRegistry {
    public async ensureModelsAvailable(requiredModels: string[]) {
        for (const modelId of requiredModels) {
            if (!this.chatModels[modelId]) {
                throw new Error(`Required model "${modelId}" is not configured in chatModels.`);
            }
        }
    }
    public providers = createReactiveConfig<Record<string, ProviderConfig>>(
        "llm:providers",
        { "default": { vendor: "openai", apiKey: "sk-xxxxxx" } },
        ProvidersConfigSchema
    );

    public chatModels = createReactiveConfig<Record<string, { providerName: string, options: ModelOptions }>>(
        "llm:chat_models",
        {
            "executor": { providerName: "default", options: { model: "gpt-3.5-turbo", temperature: 0.7, disableThinking: true, capabilities: ["tools"] } },
            "intent": { providerName: "default", options: { model: "gpt-3.5-turbo", temperature: 0.0, disableThinking: true, capabilities: [] } },
            "planner": { providerName: "default", options: { model: "gpt-3.5-turbo", temperature: 0.0, disableThinking: true, capabilities: ["tools"] } },
            "filter": { providerName: "default", options: { model: "gpt-3.5-turbo", temperature: 0.0, disableThinking: true, capabilities: [] } },
            "rag": { providerName: "default", options: { model: "gpt-3.5-turbo", temperature: 0.0, disableThinking: true, capabilities: [] } },
            "rewrite": { providerName: "default", options: { model: "gpt-3.5-turbo", temperature: 0.0, disableThinking: true, capabilities: [] } },
            "compactor": { providerName: "default", options: { model: "gpt-3.5-turbo", temperature: 0.0, disableThinking: true, capabilities: [] } }
        },
        ChatModelsConfigSchema
    );

    public embeddingsModels = createReactiveConfig<Record<string, { providerName: string, options: EmbeddingsOptions }>>(
        "llm:embeddings_models",
        {
            "embeddings": { providerName: "default", options: { model: "text-embedding-ada-002" } }
        },
        EmbeddingsModelsConfigSchema
    );

    private modelInstances = new Map<string, any>();
    private embeddingsInstances = new Map<string, any>();

    public static readonly TEMPLATES = {
        deepseek: (apiKey: string): ProviderConfig => ({
            vendor: "deepseek",
            apiKey,
            baseURL: "https://api.deepseek.com/v1"
        }),
        google: (apiKey: string): ProviderConfig => ({
            vendor: "google",
            apiKey
        }),
        openai: (apiKey: string): ProviderConfig => ({
            vendor: "openai",
            apiKey
        })
    };

    public addProvider(name: string, config: ProviderConfig): void {
        this.providers[name] = config;
    }

    public addModel(id: string, providerName: string, options: ModelOptions): void {
        this.chatModels[id] = { providerName, options };
        this.modelInstances.delete(id); // Clear runtime instance cache
    }

    public getModelConfig(id: string): { providerName: string, options: ModelOptions } | undefined {
        return this.chatModels[id];
    }

    public getModel(id: string): ChatOpenAI {
        if (this.modelInstances.has(id)) {
            return this.modelInstances.get(id);
        }

        const modelConfig = this.chatModels[id];
        if (!modelConfig) {
            throw new Error(`Model with id "${id}" is not configured in chatModels.`);
        }

        const provider = this.providers[modelConfig.providerName];
        if (!provider) {
            throw new Error(`Provider "${modelConfig.providerName}" has not been registered in providers.`);
        }

        const modelInstance = this.createChatModel({
            vendor: provider.vendor,
            apiKey: provider.apiKey,
            baseURL: provider.baseURL,
            model: modelConfig.options.model,
            temperature: modelConfig.options.temperature ?? 0.7,
            maxRetries: modelConfig.options.maxRetries ?? 2,
            modelKwargs: modelConfig.options.modelKwargs,
            disableThinking: modelConfig.options.disableThinking,
            modelId: id,
        });

        this.modelInstances.set(id, modelInstance);
        return Object.assign(modelInstance, { id }, { capabilities: modelConfig.options.capabilities }) as unknown as ChatOpenAI;
    }

    public addEmbeddings(id: string, providerName: string, options: EmbeddingsOptions): void {
        this.embeddingsModels[id] = { providerName, options };
        this.embeddingsInstances.delete(id); // Clear runtime instance cache
    }

    public getEmbeddings<T = any>(id: string): T {
        if (this.embeddingsInstances.has(id)) {
            return this.embeddingsInstances.get(id);
        }

        const modelConfig = this.embeddingsModels[id];
        if (!modelConfig) {
            throw new Error(`Embeddings with id "${id}" is not configured in embeddingsModels.`);
        }

        const provider = this.providers[modelConfig.providerName];
        if (!provider) {
            throw new Error(`Provider "${modelConfig.providerName}" has not been registered in providers.`);
        }

        let embeddingsInstance;
        if (provider.vendor === "google") {
            embeddingsInstance = new GoogleGenerativeAIEmbeddings({
                model: modelConfig.options.model,
                apiKey: provider.apiKey
            });
        } else {
            embeddingsInstance = new OpenAIEmbeddings({
                model: modelConfig.options.model,
                apiKey: provider.apiKey,
                configuration: provider.baseURL ? { baseURL: provider.baseURL } : undefined
            });
        }

        this.embeddingsInstances.set(id, embeddingsInstance);
        return Object.assign(embeddingsInstance, { id }) as unknown as T;
    }

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
