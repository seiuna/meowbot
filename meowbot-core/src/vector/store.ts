/**
 * Vector store — persists embeddings in MongoDB and supports cosine-similarity search.
 *
 * Uses a simple MongoDB collection `vector_embeddings` with schema:
 *   { docId: string, namespace: string, text: string, embedding: number[], metadata?: any }
 *
 * For search, computes cosine similarity in-app (accurate for <10k vectors).
 * Future: upgrade to MongoDB Atlas Vector Search for larger scale.
 */

import mongoose from "mongoose";
import { EmbeddingService, type EmbeddingVector } from "./embeddings.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("VectorStore");

export interface DocEntry {
    docId: string;
    namespace: string;    // e.g. "tools", "documents", "images"
    text: string;
    embedding: EmbeddingVector;
    metadata?: Record<string, any>;
}

interface SearchResult {
    docId: string;
    namespace: string;
    text: string;
    score: number;
    metadata?: Record<string, any>;
}

function getCollection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB not connected");
    return db.collection("vector_embeddings");
}

export class VectorStore {
    private static instance: VectorStore;
    private embedService: EmbeddingService;

    private constructor() {
        this.embedService = EmbeddingService.getInstance();
    }

    static getInstance(): VectorStore {
        if (!VectorStore.instance) {
            VectorStore.instance = new VectorStore();
        }
        return VectorStore.instance;
    }

    /** Ensure indexes exist. */
    async initialize(): Promise<void> {
        const col = getCollection();
        await col.createIndex({ docId: 1, namespace: 1 }, { unique: true });
        await col.createIndex({ namespace: 1 });
        logger.info("Vector store initialized.");
    }

    /**
     * Upsert a document with its embedding.
     */
    async upsert(docId: string, namespace: string, text: string, metadata?: Record<string, any>): Promise<void> {
        const embedding = await this.embedService.embed(text);
        const col = getCollection();
        await col.updateOne(
            { docId, namespace },
            { $set: { docId, namespace, text, embedding, metadata: metadata ?? {}, updatedAt: new Date() } },
            { upsert: true },
        );
    }

    /**
     * Upsert multiple documents at once.
     */
    async upsertBatch(entries: { docId: string; namespace: string; text: string; metadata?: Record<string, any> }[]): Promise<void> {
        const texts = entries.map(e => e.text);
        const embeddings = await this.embedService.embedBatch(texts);

        const col = getCollection();
        const ops = entries.map((e, i) => ({
            updateOne: {
                filter: { docId: e.docId, namespace: e.namespace },
                update: {
                    $set: {
                        docId: e.docId,
                        namespace: e.namespace,
                        text: e.text,
                        embedding: embeddings[i],
                        metadata: e.metadata ?? {},
                        updatedAt: new Date(),
                    },
                },
                upsert: true,
            },
        }));

        if (ops.length > 0) {
            await col.bulkWrite(ops, { ordered: false });
        }
    }

    /**
     * Search for similar documents by cosine similarity.
     * Returns results sorted by score descending (higher = more similar).
     */
    async search(
        query: string,
        namespace: string,
        topK: number = 10,
    ): Promise<SearchResult[]> {
        const queryEmbedding = await this.embedService.embed(query);
        const col = getCollection();

        const docs = await col.find({ namespace }).toArray();
        if (docs.length === 0) return [];

        const results: SearchResult[] = docs.map(doc => ({
            docId: doc.docId,
            namespace: doc.namespace,
            text: doc.text,
            score: this.cosineSimilarity(queryEmbedding, doc.embedding as number[]),
            metadata: doc.metadata,
        }));

        results.sort((a, b) => b.score - a.score);
        const top = results.slice(0, topK);
        logger.trace(`Search [${namespace}] "${query}" → ${top.length} hits: ${top.map(r => `${r.docId}(${(r.score*100).toFixed(1)}%)`).join(", ")}`);
        return top;
    }

    /**
     * Search across multiple namespaces.
     */
    async searchMultiNS(
        query: string,
        namespaces: string[],
        topK: number = 10,
    ): Promise<SearchResult[]> {
        const queryEmbedding = await this.embedService.embed(query);
        const col = getCollection();

        const docs = await col.find({ namespace: { $in: namespaces } }).toArray();
        if (docs.length === 0) return [];

        const results: SearchResult[] = docs.map(doc => ({
            docId: doc.docId,
            namespace: doc.namespace,
            text: doc.text,
            score: this.cosineSimilarity(queryEmbedding, doc.embedding as number[]),
            metadata: doc.metadata,
        }));

        results.sort((a, b) => b.score - a.score);
        const top = results.slice(0, topK);
        logger.trace(`SearchMulti [${namespaces.join(",")}] "${query}" → ${top.length} hits: ${top.map(r => `${r.docId}(${(r.score*100).toFixed(1)}%)`).join(", ")}`);
        return top;
    }

    /** Delete a document. */
    async delete(docId: string, namespace: string): Promise<void> {
        const col = getCollection();
        await col.deleteOne({ docId, namespace });
    }

    /** Get count for a namespace. */
    async count(namespace: string): Promise<number> {
        const col = getCollection();
        return col.countDocuments({ namespace });
    }

    /** Cos similarity between two L2-normalized vectors. */
    private cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * (b[i] ?? 0);
        }
        return dot; // Vectors are already L2-normalized
    }
}
