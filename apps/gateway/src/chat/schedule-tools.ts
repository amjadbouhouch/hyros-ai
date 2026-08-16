import type { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
    createAgentSchedule,
    deleteAgentSchedule,
    listAgentSchedules,
    updateAgentSchedule,
    type ScheduleOwner,
} from "./schedule-service.js";

const statusSchema = z.enum(["active", "paused"]);
const summarySchema = z.object({
    id: z.string(),
    name: z.string(),
    prompt: z.string(),
    cron: z.string(),
    timezone: z.string().nullable(),
    status: statusSchema,
    nextFireAt: z.string().nullable(),
    lastFireAt: z.string().nullable(),
});

const timezoneSchema = z.string().min(1).refine((timezone) => {
    try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
        return true;
    } catch {
        return false;
    }
}, "Use a valid IANA timezone such as America/New_York");

export function buildScheduleTools(args: { mastra: Mastra; owner: ScheduleOwner }) {
    const { mastra, owner } = args;
    return {
        createSchedule: createTool({
            id: "create_schedule",
            description:
                "Create recurring work for yourself only when the user explicitly asks. " +
                "Use a cron expression and the user's IANA timezone; ask when the timezone is unknown.",
            inputSchema: z.object({
                name: z.string().min(1),
                prompt: z.string().min(1),
                cron: z.string().min(1),
                timezone: timezoneSchema,
                status: statusSchema.optional(),
            }),
            outputSchema: summarySchema,
            execute: (input) => createAgentSchedule(mastra, owner, input),
        }),
        listSchedules: createTool({
            id: "list_schedules",
            description: "List all recurring schedules owned by this agent.",
            inputSchema: z.object({}),
            outputSchema: z.object({ schedules: z.array(summarySchema) }),
            execute: async () => ({ schedules: await listAgentSchedules(mastra, owner) }),
        }),
        updateSchedule: createTool({
            id: "update_schedule",
            description:
                "Update one of this agent's schedules when the user explicitly asks. " +
                "Use status paused or active to pause or resume it.",
            inputSchema: z
                .object({
                    scheduleId: z.string().min(1),
                    name: z.string().min(1).optional(),
                    prompt: z.string().min(1).optional(),
                    cron: z.string().min(1).optional(),
                    timezone: timezoneSchema.optional(),
                    status: statusSchema.optional(),
                })
                .refine(
                    ({ scheduleId: _scheduleId, ...patch }) =>
                        Object.values(patch).some((value) => value !== undefined),
                    "Provide at least one field to update",
                ),
            outputSchema: summarySchema,
            execute: ({ scheduleId, ...input }) =>
                updateAgentSchedule(mastra, owner, scheduleId, input),
        }),
        deleteSchedule: createTool({
            id: "delete_schedule",
            description:
                "Permanently delete one of this agent's schedules only when the user explicitly asks.",
            inputSchema: z.object({ scheduleId: z.string().min(1) }),
            outputSchema: z.object({ ok: z.literal(true), scheduleId: z.string() }),
            execute: async ({ scheduleId }) => {
                await deleteAgentSchedule(mastra, owner, scheduleId);
                return { ok: true as const, scheduleId };
            },
        }),
    };
}
