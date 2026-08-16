/**
 * Agent-facing tools for the chat runtime.
 *
 * `update_profile` is the onboarding-completion tool (TASK-024): the agent
 * calls it on its own row once the ask_user interview has produced a name,
 * description, and avatar selection. Writing the row flips the runtime's dynamic
 * instructions from spawn to persona on the next turn (see ./runtime.ts).
 */

import { createTool } from "@mastra/core/tools";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { agents } from "@hyros-ai/db";
import { db } from "../lib/db.js";
import { avatarSelectionSchema, renderAvatarDataUri } from "./avatar.js";
import type { AgentRow } from "./runtime.js";

export function buildUpdateProfileTool(row: AgentRow) {
    return createTool({
        id: "update_profile",
        description:
            "Persist your profile after onboarding or when the user asks you to change it: " +
            "display name, a 1-2 sentence " +
            "description of what you do and how you behave, and a DiceBear avatar " +
            "selection containing an explicit style and config. The seed makes the " +
            "chosen variation deterministic; it is not a natural-language image prompt. " +
            "During onboarding, call exactly once when the interview has given you enough.",
        inputSchema: z.object({
            name: z.string().min(1),
            description: z.string().min(1),
            avatar: avatarSelectionSchema,
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            name: z.string(),
            avatarStyle: avatarSelectionSchema.shape.style,
        }),
        execute: async ({ name, description, avatar }) => {
            await db
                .update(agents)
                .set({
                    name,
                    description,
                    avatarUrl: renderAvatarDataUri(avatar),
                    updatedAt: new Date(),
                })
                .where(and(eq(agents.id, row.id), isNull(agents.archivedAt)));
            return { ok: true, name, avatarStyle: avatar.style };
        },
    });
}
