/**
 * Agent configuration — parsed from /agents/{name}/AGENT.md YAML frontmatter.
 *
 * AGENT.md format:
 *   ---
 *   name: default-agent
 *   description: A default agent
 *   tools: [ask_user, finish_task, search_tools, call_tools]
 *   prompt: agent-system
 *   ---
 */

export interface AgentConfig {
    name: string;
    description: string;
    /** Essential tool names this agent starts with. All others via search_tools. */
    tools: string[];
    /** System prompt — AGENT.md body content after YAML frontmatter */
    prompt: string;
    /** Source directory for few-shot.json */
    sourceDir?: string;
    /** Whether this agent can be used as a sub-agent via run_subagent */
    as_sub_agent?: boolean;
}
