import { DynamicStructuredTool } from "@langchain/core/tools";
import { IToolProvider } from "@meowbot/tools/tool_registry";
import {
    makePlanTool,
    markStepCompleteTool,
    finishTaskTool,
    imageViewerTool,
    decorateReplyTool,
} from "../other/tools_other.js";

export class SystemToolProvider implements IToolProvider {
    private tools: DynamicStructuredTool[];

    constructor() {
        this.tools = [
            makePlanTool,
            markStepCompleteTool,
            finishTaskTool,
            imageViewerTool,
            decorateReplyTool,
        ];
    }

    pullAllTools(): DynamicStructuredTool[] {
        return this.tools;
    }

    getName(): string {
        return "System";
    }

    getDescription(): string {
        return "Core system tools — web search, image viewer, todo list, task tracking";
    }
}
