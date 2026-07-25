import { BaseAgent } from "./types";
import { getLogger } from "@meowbot/utils/logs";

const logger = getLogger("AgentRegistry");

export class AgentRegistry {
    private agents: Map<string, BaseAgent> = new Map();
    private defaultAgentId: string = "default-agent";

    public registerAgent(agentId: string, agent: BaseAgent): void {
        if (this.agents.has(agentId)) {
            logger.warn(`Agent ${agentId} already registered, overwriting`);
        }
        this.agents.set(agentId, agent);
        logger.info(`Registered agent: ${agentId}`);
    }

    public getAgent(agentId: string): BaseAgent | undefined {
        return this.agents.get(agentId) ?? this.agents.get(this.defaultAgentId);
    }

    public setDefaultAgent(agentId: string): void {
        if (!this.agents.has(agentId)) {
            throw new Error(`Agent ${agentId} not found`);
        }
        this.defaultAgentId = agentId;
    }

    public hasAgent(agentId: string): boolean {
        return this.agents.has(agentId);
    }

    /** List all registered agent IDs */
    public list(): string[] {
        return Array.from(this.agents.keys());
    }

    /** Get all registered agents as a Map */
    public getAll(): Map<string, BaseAgent> {
        return new Map(this.agents);
    }

    /** Get the default agent ID */
    public getDefaultAgentId(): string {
        return this.defaultAgentId;
    }
}

export const agentRegistry = new AgentRegistry();
