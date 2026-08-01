/**
 * Vector module — embedding computation, storage, search, and retrieval.
 *
 * Quick start:
 *   import { getVectorRetriever } from "./vector/index.js";
 *   await getVectorRetriever().bootstrap();  // indexes all tools
 *   const hits = await getVectorRetriever().searchTools("notion");
 */

export { EmbeddingService, type EmbeddingVector } from "./embeddings.js";
export { VectorStore, type DocEntry } from "./store.js";
export { ToolIndexer } from "./tool_indexer.js";
export { SkillIndexer } from "./skill_indexer.js";
export { VectorRetriever, getVectorRetriever, type SearchHit } from "./retriever.js";
