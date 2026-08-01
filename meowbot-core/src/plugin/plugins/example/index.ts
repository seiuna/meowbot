import { Plugin, PluginContext } from "../../index.js";
import { resolve } from "node:path";

export default class ExamplePlugin extends Plugin {
    name = "example";
    version = "1.0.0";
    description = "An example plugin";

    async onLoad(): Promise<void> {
        // Plugin initialization logic here
    }

    async onInit(context: PluginContext): Promise<void> {
        const { commandRegistry } = context;
        // Register the bundled example skill with the SkillRegistry.
        await context.registerSkill(
            "example-plugin-skill",
            resolve(import.meta.dirname, "skills", "example-plugin-skill"),
            "skill",
        );
    }

    async onUnload(): Promise<void> {
        // Cleanup logic here
    }
}
