
// Export the singleton registry
import {ModelRegistry} from "@meowbot/llm/provider_registry";

export const modelRegistry = new ModelRegistry();

export function initializeModelRegistry() {
    // Model configuration logic has been fully moved to use createReactiveConfig inside ModelRegistry,
    // so we don't need manual loading loops here.
    // If you need to perform additional startup logic, place it here.
}

// Export types and class for users who want to create their own registries