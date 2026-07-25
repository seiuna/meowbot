import { Plugin, PluginContext } from "../../index.js";

export default class ExamplePlugin extends Plugin {
    name = "example";
    version = "1.0.0";
    description = "An example plugin";

    async onLoad(): Promise<void> {
        // Plugin initialization logic here
    }

    async onInit(context: PluginContext): Promise<void> {
        const { commandRegistry } = context;
    }

    async onUnload(): Promise<void> {
        // Cleanup logic here
    }
}
