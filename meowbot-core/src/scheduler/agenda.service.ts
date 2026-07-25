import { Agenda } from "agenda";
import { MongoBackend } from "@agendajs/mongo-backend";
import { getLogger } from "@meowbot/utils/logs";
import { getMongoDBClient } from "@meowbot/database/mongodb";
import { mongoDBConfig } from "@meowbot/config/app-config";

const logger = getLogger("AgendaService");

let agendaInstance: Agenda | null = null;

/** Build MongoDB URI, delegated to MongoDBClient for consistency. */
function buildUri(): string {
    const client = getMongoDBClient();
    // Access the private builder by constructing a temp connection string
    const c = mongoDBConfig;
    const auth = c.username && c.password
        ? encodeURIComponent(c.username) + ":" + encodeURIComponent(c.password) + "@"
        : "";
    return "mongodb://" + auth + c.host + ":" + c.port + "/" + c.database;
}

export async function getAgenda(): Promise<Agenda> {
    if (agendaInstance) return agendaInstance;

    const uri = buildUri();
    logger.info("Agenda connecting to: " + uri.replace(/\/\/.*@/, "//***@"));

    const backend = new MongoBackend({
        address: uri,
        collection: "agenda_jobs",
    });

    agendaInstance = new Agenda({
        backend,
        processEvery: "30 seconds",
    });

    agendaInstance.define("agent_global_job", async (job) => {
        const data = job.attrs.data as any;
        logger.info(
            "[Agenda] Job fired: " + (data?.taskName ?? job.attrs.name) +
            " | notifyTargets: " + ((data?.notifyTargetIds ?? []).length),
        );

        try {
            // Lazy-import to avoid circular deps at module level
            const { ScheduledCustomAgent } = await import("../tools/subagent/custom_agent.js");
            const { toolRegistry } = await import("../tools/tool_registry.js");

            const providers: string[] = data?.toolProviders ?? [];
            const safe = providers.filter((p: string) => p.toLowerCase() !== "subagent");
            const tools = safe.length > 0 ? toolRegistry.getToolsForProviders(safe) : [];

            const agent = new ScheduledCustomAgent(
                "scheduled-" + (data?.taskName ?? "job"),
                data?.systemPrompt ?? "Complete the task described.",
                tools,
                data?.notifyTargetIds ?? [],
                data?.taskName ?? "Scheduled",
            );
            const result = await agent.run(data?.userPrompt ?? "");

            logger.info("[Agenda] Job result (" + (data?.taskName ?? "?") + "): " + result.output.substring(0, 200));
        } catch (err: any) {
            logger.error("[Agenda] Job failed: " + (err.message ?? String(err)));
        }
    });

    await agendaInstance.start();
    logger.info("Agenda started");

    return agendaInstance;
}

