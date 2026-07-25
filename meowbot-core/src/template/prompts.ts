/**
 * Prompts — backward-compatible re-export from the unified SkillRegistry.
 *
 * All existing code using `Prompts.build(name, data)` continues to work.
 * The underlying storage is now folder-based under `skills/`.
 */

export { Prompts, SkillRegistry } from "./skill-registry.js";
export { Skill } from "./skill.js";
export type { SkillMeta, FewShotPair } from "./skill.js";
