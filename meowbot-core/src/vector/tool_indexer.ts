/**
 * Tool indexer — indexes tool names + descriptions for vector search.
 * Also serves as the reference pattern for indexing other domains (documents, images).
 */

import { VectorStore } from "./store.js";
import { EmbeddingService } from "./embeddings.js";
import { toolRegistry } from "../tools/tool_registry.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("ToolIndexer");

const NAMESPACE = "tools";

export class ToolIndexer {
    private store: VectorStore;
    private embedService: EmbeddingService;

    constructor() {
        this.store = VectorStore.getInstance();
        this.embedService = EmbeddingService.getInstance();
    }

    /**
     * Index all registered tools. Called at startup.
     * Each tool is indexed by: "name: description" text.
     */
    async indexAllTools(): Promise<number> {
        const tools = toolRegistry.getAllTools();
        const entries: { docId: string; namespace: string; text: string; metadata?: Record<string, any> }[] = [];

        for (const tool of tools) {
            const text = `${tool.name}: ${tool.description || ""}`;
            entries.push({
                docId: `tool:${tool.name}`,
                namespace: NAMESPACE,
                text,
                metadata: { toolName: tool.name },
            });
        }

        if (entries.length === 0) {
            logger.warn("No tools found to index.");
            return 0;
        }

        await this.store.upsertBatch(entries);
        await this.embedService.flush();
        logger.info(`Indexed ${entries.length} tools.`);
        return entries.length;
    }

    /**
     * Refresh tool index — re-index tools that have changed or been added.
     * Called periodically or on tool hot-reload.
     */
    async refreshToolIndex(): Promise<number> {
        // Simple approach: just re-index everything
        return this.indexAllTools();
    }

    /**
     * Search tools by description/name.
     */
    async searchTools(query: string, topK: number = 5): Promise<Array<{ name: string; description: string; score: number }>> {
        const results = await this.store.search(query, NAMESPACE, topK);
        return results.map(r => ({
            name: r.metadata?.toolName || r.docId,
            description: r.text.split(": ").slice(1).join(": ") || r.text,
            score: Math.round(r.score * 100) / 100,
        }));
    }
}
