import { Middleware, SessionContext, SessionType } from "@meowbot/gateway";
import { agentRegistry } from "./agent_registry";
import { getLogger } from "@meowbot/utils/logs";

const logger = getLogger("AgentDispatcher");

export const AgentDispatcherMiddleware: Middleware<SessionContext<SessionType>> = async (ctx, _next) => {
    const agentId = ctx.route.agentId;
    const agent = agentRegistry.getAgent(agentId);

    if (!agent) {
        logger.error(`No agent found for agentId: ${agentId}`);
        ctx.exception(new Error(`No agent registered for id: ${agentId}`));
        return;
    }

    if (ctx.route.ttl <= 0) {
        logger.error(`TTL exceeded for message, routing path: ${ctx.route.path.join(" -> ")}`);
        ctx.exception(new Error("Message routing TTL exceeded"));
        return;
    }

    try {
        await agent.execute(ctx);
    } catch (error) {
        logger.error(`Agent ${agentId} error:`, error);
        ctx.exception(error as Error);
    }
};
