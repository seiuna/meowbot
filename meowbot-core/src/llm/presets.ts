/**
 * Built-in LLM provider presets.
 *
 * Each preset defines vendor, default base URL, and a curated list of models.
 * Users reference presets in config.json — just pick a preset and provide an API key.
 */

import type { Vendor, ModelCapability } from "@meowbot/shared";

export interface PresetModel {
    /** Model ID string (e.g. "deepseek-v4-flash") */
    id: string;
    /** Human-readable name (e.g. "DeepSeek V4 Flash") */
    name: string;
    /** Model capabilities */
    capabilities: ModelCapability[];
    /** Whether this model supports thinking/reasoning mode */
    supportsThinking?: boolean;
}

export interface PresetDef {
    /** Provider vendor */
    vendor: Vendor;
    /** Default base URL (empty = user must provide, e.g. for openai_compatible) */
    baseURL: string;
    /** Available models for this provider */
    models: PresetModel[];
    /** Whether user can add custom models not in the list */
    allowCustomModels: boolean;
}

export const BUILTIN_PRESETS: Record<string, PresetDef> = {
    deepseek: {
        vendor: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        allowCustomModels: false,
        models: [
            {
                id: "deepseek-v4-flash",
                name: "DeepSeek V4 Flash",
                capabilities: ["tools"],
                supportsThinking: false,
            },
            {
                id: "deepseek-v4",
                name: "DeepSeek V4",
                capabilities: ["tools"],
                supportsThinking: true,
            },
            {
                id: "deepseek-chat",
                name: "DeepSeek V3",
                capabilities: ["tools"],
                supportsThinking: false,
            },
            {
                id: "deepseek-reasoner",
                name: "DeepSeek R1",
                capabilities: ["tools"],
                supportsThinking: true,
            },
        ],
    },

    openai: {
        vendor: "openai",
        baseURL: "https://api.openai.com/v1",
        allowCustomModels: false,
        models: [
            {
                id: "gpt-4.1",
                name: "GPT-4.1",
                capabilities: ["tools", "vision"],
                supportsThinking: false,
            },
            {
                id: "gpt-4.1-mini",
                name: "GPT-4.1 Mini",
                capabilities: ["tools", "vision"],
                supportsThinking: false,
            },
            {
                id: "gpt-4o",
                name: "GPT-4o",
                capabilities: ["tools", "vision"],
                supportsThinking: false,
            },
            {
                id: "gpt-4o-mini",
                name: "GPT-4o Mini",
                capabilities: ["tools", "vision"],
                supportsThinking: false,
            },
        ],
    },

    google: {
        vendor: "google",
        baseURL: "",
        allowCustomModels: false,
        models: [
            {
                id: "gemini-2.5-flash",
                name: "Gemini 2.5 Flash",
                capabilities: ["tools", "vision", "audio"],
                supportsThinking: false,
            },
            {
                id: "gemini-2.5-pro",
                name: "Gemini 2.5 Pro",
                capabilities: ["tools", "vision", "audio"],
                supportsThinking: true,
            },
        ],
    },

    ollama: {
        vendor: "openai_compatible",
        baseURL: "http://localhost:11434/v1",
        allowCustomModels: true,
        models: [
            { id: "llama3.2", name: "Llama 3.2", capabilities: ["tools"] },
            { id: "qwen3", name: "Qwen 3", capabilities: ["tools"] },
            { id: "mistral", name: "Mistral", capabilities: ["tools"] },
        ],
    },

    "openai-compatible": {
        vendor: "openai_compatible",
        baseURL: "",
        allowCustomModels: true,
        models: [],
    },
};

/** Resolve a preset by name. Returns undefined if not found. */
export function resolvePreset(name: string): PresetDef | undefined {
    return BUILTIN_PRESETS[name];
}

/** Resolve a model within a preset by ID. Returns undefined if the preset doesn't allow custom models and the model isn't listed. */
export function resolveModel(preset: PresetDef, modelId: string): PresetModel | undefined {
    const builtin = preset.models.find(m => m.id === modelId);
    if (builtin) return builtin;
    if (preset.allowCustomModels) {
        return { id: modelId, name: modelId, capabilities: ["tools"] };
    }
    return undefined;
}

/** List all available preset names. */
export function listPresets(): string[] {
    return Object.keys(BUILTIN_PRESETS);
}

/** Get the default model for a preset (first in the list). */
export function getDefaultModel(preset: PresetDef): string | undefined {
    return preset.models[0]?.id;
}
