import { SkillRegistry } from "@meowbot/template/prompts";
import { getLogger } from "@meowbot/utils/logs";
import { bootstrapAgents } from "./agent_loader.js";

const logger = getLogger("AgentBootstrap");

export async function bootstrapAgentRegistry(): Promise<void> {
    // Validate that required utility templates exist
    const requiredSkills = ["agent-system", "content-filter", "context-compact"];
    for (const name of requiredSkills) {
        const skill = await SkillRegistry.get(name);
        if (!skill) {
            logger.warn(`Warning: template "${name}" not found — some features may not work.`);
        }
    }

    // Dynamically load agents from /agents folder
    await bootstrapAgents();

    logger.info("Agent registry bootstrapped successfully");
}
