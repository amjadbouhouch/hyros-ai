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
import { slugifyAgentName } from "./agent-slug.js";
import { avatarSelectionSchema, renderAvatarDataUri } from "./avatar.js";
import type { AgentRow } from "./runtime.js";

const AGENT_NAME_MAX_LENGTH = 80;

const agentNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(AGENT_NAME_MAX_LENGTH)
    .refine((name) => slugifyAgentName(name).length > 0, {
        message: "Name must contain at least one letter from A-Z or a number.",
    });

function isAgentSlugConflict(error: unknown): boolean {
    let candidate: unknown = error;
    for (let depth = 0; depth < 3; depth += 1) {
        if (!candidate || typeof candidate !== "object") return false;
        const postgresError = candidate as {
            code?: unknown;
            constraint_name?: unknown;
            cause?: unknown;
        };
        if (
            postgresError.code === "23505" &&
            postgresError.constraint_name === "agents_owner_slug_uidx"
        ) {
            return true;
        }
        candidate = postgresError.cause;
    }
    return false;
}

export function buildUpdateProfileTool(row: AgentRow) {
    return createTool({
        id: "update_profile",
        description:
            "Persist your profile after onboarding or when the user asks you to change it: " +
            "display name, a 1-2 sentence " +
            "description of what you do and how you behave, and a DiceBear avatar " +
            "selection containing an explicit style and config. The seed makes the " +
            "chosen variation deterministic; it is not a natural-language image prompt. " +
            "During onboarding, call when the interview has given you enough. If the result " +
            "has ok=false, do not claim success: follow its error and retry with a different " +
            "valid name when requested.",
        inputSchema: z.object({
            name: agentNameSchema,
            description: z.string().min(1),
            avatar: avatarSelectionSchema,
        }),
        outputSchema: z.discriminatedUnion("ok", [
            z.object({
                ok: z.literal(true),
                name: z.string(),
                slug: z.string(),
                avatarStyle: avatarSelectionSchema.shape.style,
            }),
            z.object({
                ok: z.literal(false),
                name: z.string(),
                error: z.string(),
            }),
        ]),
        execute: async ({ name, description, avatar }) => {
            const slug = slugifyAgentName(name);
            try {
                const updated = await db
                    .update(agents)
                    .set({
                        name,
                        slug,
                        description,
                        avatarUrl: renderAvatarDataUri(avatar),
                        updatedAt: new Date(),
                    })
                    .where(and(eq(agents.id, row.id), isNull(agents.archivedAt)))
                    .returning({ id: agents.id });
                if (updated.length === 0) {
                    return {
                        ok: false as const,
                        name,
                        error: "This agent is no longer active, so its profile was not changed.",
                    };
                }
                return {
                    ok: true as const,
                    name,
                    slug,
                    avatarStyle: avatar.style,
                };
            } catch (error) {
                if (isAgentSlugConflict(error)) {
                    return {
                        ok: false as const,
                        name,
                        error:
                            "Another agent belonging to this user already has that name. Choose a different display name and call updateProfileTool again.",
                    };
                }
                throw error;
            }
        },
    });
}
