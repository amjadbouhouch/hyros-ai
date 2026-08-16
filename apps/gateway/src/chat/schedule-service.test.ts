import { describe, expect, test } from "bun:test";

import {
    DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID,
    deleteAgentSchedule,
    deleteAllAgentSchedules,
    listAgentSchedules,
    updateAgentSchedule,
} from "./schedule-service.js";

const now = Date.parse("2026-08-16T09:00:00.000Z");

function workflowSchedule(overrides: Record<string, unknown> = {}) {
    return {
        id: "schedule_one",
        workflowId: DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID,
        cron: "0 9 * * *",
        timezone: "Africa/Tunis",
        status: "active" as const,
        nextFireAt: now,
        createdAt: now,
        updatedAt: now,
        inputData: {
            agentId: "agent-a",
            ownerId: "owner-a",
            name: "Daily briefing",
            prompt: "Prepare my briefing.",
        },
        metadata: { hyrosAgentId: "agent-a", hyrosOwnerId: "owner-a" },
        ...overrides,
    };
}

function fakeMastra(rows: ReturnType<typeof workflowSchedule>[]) {
    const deleted: string[] = [];
    let updatedPatch: Record<string, unknown> | undefined;
    const schedules = {
        list: async () => rows,
        get: async (id: string) => rows.find((row) => row.id === id) ?? null,
        update: async (id: string, patch: Record<string, unknown>) => {
            updatedPatch = patch;
            return { ...rows.find((row) => row.id === id)!, ...patch };
        },
        delete: async (id: string) => {
            deleted.push(id);
        },
    };
    return {
        mastra: { schedules } as never,
        deleted,
        updatedPatch: () => updatedPatch,
    };
}

describe("agent schedule ownership", () => {
    test("lists only schedules whose metadata and input match the owner", async () => {
        const { mastra } = fakeMastra([
            workflowSchedule(),
            workflowSchedule({ id: "other", metadata: { hyrosAgentId: "agent-b", hyrosOwnerId: "owner-a" } }),
            workflowSchedule({ id: "forged", inputData: { agentId: "agent-a", ownerId: "owner-b", name: "x", prompt: "x" } }),
        ]);

        const result = await listAgentSchedules(mastra, { agentId: "agent-a", ownerId: "owner-a" });
        expect(result.map((schedule) => schedule.id)).toEqual(["schedule_one"]);
    });

    test("rejects cross-agent deletion without touching storage", async () => {
        const { mastra, deleted } = fakeMastra([workflowSchedule()]);
        await expect(
            deleteAgentSchedule(mastra, { agentId: "agent-b", ownerId: "owner-a" }, "schedule_one"),
        ).rejects.toThrow("schedule not found");
        expect(deleted).toEqual([]);
    });

    test("updates display input without losing ownership or prompt", async () => {
        const { mastra, updatedPatch } = fakeMastra([workflowSchedule()]);
        await updateAgentSchedule(
            mastra,
            { agentId: "agent-a", ownerId: "owner-a" },
            "schedule_one",
            { name: "Morning briefing", status: "paused" },
        );

        expect(updatedPatch()).toMatchObject({
            status: "paused",
            inputData: {
                agentId: "agent-a",
                ownerId: "owner-a",
                name: "Morning briefing",
                prompt: "Prepare my briefing.",
            },
        });
    });

    test("archive cleanup deletes every schedule owned by only that agent", async () => {
        const { mastra, deleted } = fakeMastra([
            workflowSchedule(),
            workflowSchedule({ id: "schedule_two" }),
            workflowSchedule({
                id: "other_agent",
                inputData: {
                    agentId: "agent-b",
                    ownerId: "owner-a",
                    name: "Other",
                    prompt: "Other",
                },
                metadata: { hyrosAgentId: "agent-b", hyrosOwnerId: "owner-a" },
            }),
        ]);

        const count = await deleteAllAgentSchedules(mastra, {
            agentId: "agent-a",
            ownerId: "owner-a",
        });
        expect(count).toBe(2);
        expect(deleted.sort()).toEqual(["schedule_one", "schedule_two"]);
    });
});
