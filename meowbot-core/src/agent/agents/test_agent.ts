import { BaseAgent } from "../types";
import { SessionContext } from "@meowbot/gateway";
import { getLogger } from "@meowbot/utils/logs";
import type { CompiledStateGraph } from "@langchain/langgraph";

const logger = getLogger("TestAgent");

export class TestAgent extends BaseAgent {

    constructor() {
        super("test-agent", "A test agent for handling test sessions.");
    }

    getGraph(): CompiledStateGraph<any, any, any> {
        throw new Error("TestAgent does not use LangGraph");
    }

    async handleSession(session: SessionContext): Promise<void> {
        logger.info(`TestAgent handling session: ${session.sessionId}`);
        session.message("TestAgent: 消息已收到，处理功能尚未实现。");
    }
}
