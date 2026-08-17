/**
 * Skills every agent ships with.
 *
 * Three tiers reach an agent, and this is the first:
 *
 * | Tier      | Lives in                            | Written by     |
 * |-----------|-------------------------------------|----------------|
 * | shipped   | here, as `createSkill()` calls       | us             |
 * | org-wide  | `/workspace/.shared/skills`          | an operator    |
 * | per-agent | `/workspace/<agentId>/skills`        | the agent      |
 *
 * Shipped skills are code, not files: `createSkill()` needs no filesystem, so
 * these work whether or not the agent has a sandbox, they version with the
 * gateway, and there is nothing to provision. The other two tiers are discovered
 * inside the container by `sandbox/skill-source.ts`.
 *
 * Mastra merges the tiers with agent-level skills winning on a name collision, so
 * a name here is effectively reserved: an agent that installs its own
 * `csv-summary` would be shadowed by this one. Keep these names specific.
 *
 * Only the name and description of each are injected up front. The instructions
 * are loaded when the model activates the skill, so they can afford to be
 * thorough — but the description is what decides whether it is ever activated,
 * so that is the line to get right.
 */

import type { InlineSkill } from "@mastra/core/skills";

import { csvSummarySkill } from "./csv-summary.js";
import { pdfTextExtractSkill } from "./pdf-text-extract.js";

export const SHIPPED_SKILLS: InlineSkill[] = [csvSummarySkill, pdfTextExtractSkill];

export { csvSummarySkill, pdfTextExtractSkill };
