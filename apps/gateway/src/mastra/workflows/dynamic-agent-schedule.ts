import { createStep, createWorkflow } from "@mastra/core/workflows";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { agents, users } from "@hyros-ai/db";
import { getRuntime } from "../../chat/runtime.js";
import { createRuntimeContext } from "../../chat/runtime-context.js";
import { DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID } from "../../chat/schedule-service.js";
import { db } from "../../lib/db.js";

const inputSchema = z.object({
    agentId: z.string().uuid(),
    ownerId: z.string().uuid(),
    name: z.string().min(1),
    prompt: z.string().min(1),
});

const outputSchema = z.object({
    delivered: z.boolean(),
    reason: z.string().optional(),
});

const deliverScheduledPrompt = createStep({
    id: "deliver-scheduled-prompt",
    inputSchema,
    outputSchema,
    execute: async ({ inputData, mastra }) => {
        const [row, user] = await Promise.all([
            db.query.agents.findFirst({
                where: and(
                    eq(agents.id, inputData.agentId),
                    eq(agents.ownerId, inputData.ownerId),
                    isNull(agents.archivedAt),
                ),
            }),
            db.query.users.findFirst({ where: eq(users.id, inputData.ownerId) }),
        ]);
        if (!row || !user) return { delivered: false, reason: "agent unavailable" };

        const currentUser = {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
        };

        const runtime = await getRuntime({ row, mastra });
        const session = await runtime.getSession(currentUser);
        if (session.suspensions.hasPending()) {
            return { delivered: false, reason: "agent is waiting for user input" };
        }
        if (session.run.isRunning()) {
            return { delivered: false, reason: "agent is already running" };
        }
        await session.sendMessage({
            content: inputData.prompt,
            requestContext: createRuntimeContext(row, currentUser),
        });
        return { delivered: true };
    },
});

export const dynamicAgentScheduleWorkflow = createWorkflow({
    id: DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID,
    inputSchema,
    outputSchema,
})
    .then(deliverScheduledPrompt)
    .commit();
