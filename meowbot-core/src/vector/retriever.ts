/**
 * Vector Retriever — high-level API for vector search.
 *
 * Supports:
 *   - Tool search (by name/description)
 *   - Document RAG (arbitrary text documents)
 *   - Future: image search (cross-modal embeddings)
 */

import { VectorStore } from "./store.js";
import { EmbeddingService } from "./embeddings.js";
import { ToolIndexer } from "./tool_indexer.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("VectorRetriever");

export interface SearchHit {
    docId: string;
    namespace: string;
    text: string;
    score: number;
    metadata?: Record<string, any>;
}

export class VectorRetriever {
    private store: VectorStore;
    private toolIndexer: ToolIndexer;

    constructor() {
        this.store = VectorStore.getInstance();
        this.toolIndexer = new ToolIndexer();
    }

    /** Index all tools at startup. No-op if embedding is disabled. */
    async bootstrap(): Promise<void> {
        const embedSvc = EmbeddingService.getInstance();
        if (!embedSvc.isEnabled) {
            logger.info("Embedding disabled — skipping vector bootstrap.");
            return;
        }
        await this.store.initialize();
        const count = await this.toolIndexer.indexAllTools();
        logger.info(`Vector retriever ready — ${count} tools indexed.`);
    }

    /**
     * Search tools by query.
     */
    async searchTools(query: string, topK: number = 5): Promise<SearchHit[]> {
        const results = await this.store.search(query, "tools", topK);
        return results;
    }

    /**
     * Search documents (RAG) by query.
     */
    async searchDocuments(query: string, topK: number = 5): Promise<SearchHit[]> {
        const results = await this.store.search(query, "documents", topK);
        return results;
    }

    /**
     * Search across all namespaces.
     */
    async searchAll(query: string, topK: number = 10): Promise<SearchHit[]> {
        const results = await this.store.searchMultiNS(query, ["tools", "documents"], topK);
        return results;
    }

    /**
     * Add a document to the RAG store.
     */
    async addDocument(docId: string, text: string, metadata?: Record<string, any>): Promise<void> {
        await this.store.upsert(docId, "documents", text, metadata);
    }

    /**
     * Add multiple documents.
     */
    async addDocuments(entries: { docId: string; text: string; metadata?: Record<string, any> }[]): Promise<void> {
        await this.store.upsertBatch(entries.map(e => ({
            docId: e.docId,
            namespace: "documents",
            text: e.text,
            metadata: e.metadata,
        })));
    }

    /**
     * Delete a document.
     */
    async deleteDocument(docId: string): Promise<void> {
        await this.store.delete(docId, "documents");
    }
}

/** Singleton accessor. */
let _retriever: VectorRetriever | null = null;

export function getVectorRetriever(): VectorRetriever {
    if (!_retriever) _retriever = new VectorRetriever();
    return _retriever;
}
