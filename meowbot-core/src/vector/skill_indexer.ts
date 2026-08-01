/**
 * Skill indexer — indexes skills (prompts / tool-skills / templates) into the
 * vector store under the "skills" namespace with docIds of `skill:<name>`.
 *
 * Follows the ToolIndexer pattern; enables the vector branch of search_skill.
 */

import { VectorStore } from "./store.js";
import { EmbeddingService } from "./embeddings.js";
import { SkillRegistry } from "@meowbot/template/prompts.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("SkillIndexer");

const NAMESPACE = "skills";
/** Prompt body preview length per indexed skill. */
const PROMPT_PREVIEW_LIMIT = 2000;

export class SkillIndexer {
    private store: VectorStore;
    private embedService: EmbeddingService;

    constructor() {
        this.store = VectorStore.getInstance();
        this.embedService = EmbeddingService.getInstance();
    }

    /**
     * Index all skills from the SkillRegistry. No-op when embeddings are
     * disabled. Safe to call again after a registry reload (upserts in place).
     */
    async indexAllSkills(): Promise<number> {
        if (!this.embedService.isEnabled) {
            logger.info("Embedding disabled - skipping skill indexing.");
            return 0;
        }

        const names = await SkillRegistry.list();
        const entries: Array<{
            docId: string;
            namespace: string;
            text: string;
            metadata?: Record<string, any>;
        }> = [];

        for (const name of names) {
            const skill = await SkillRegistry.get(name);
            if (!skill) continue;
            const promptPreview = skill.prompt().slice(0, PROMPT_PREVIEW_LIMIT);
            const text = `${name}: ${skill.meta.description || ""}\n${promptPreview}`;
            entries.push({
                docId: `skill:${name}`,
                namespace: NAMESPACE,
                text,
                metadata: {
                    category: skill.meta.category,
                    tools: skill.meta.tools,
                    requiredProviders: skill.meta.requiredProviders,
                    asSubAgent: skill.meta.asSubAgent,
                },
            });
        }

        if (entries.length === 0) {
            logger.warn("No skills found to index.");
            return 0;
        }

        await this.store.upsertBatch(entries);
        await this.embedService.flush();
        logger.info(`Indexed ${entries.length} skills.`);
        return entries.length;
    }
}
