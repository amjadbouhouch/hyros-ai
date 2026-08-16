import type { Mastra } from "@mastra/core/mastra";
import type { AnySchedule, WorkflowSchedule } from "@mastra/core/schedules";

import type { AgentScheduleSummary } from "@hyros-ai/domain";

export const DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID = "run-dynamic-agent-schedule";

const HYROS_AGENT_ID = "hyrosAgentId";
const HYROS_OWNER_ID = "hyrosOwnerId";

export interface ScheduleOwner {
    agentId: string;
    ownerId: string;
}

export interface ScheduleInput extends ScheduleOwner {
    name: string;
    prompt: string;
}

export interface CreateAgentScheduleInput {
    name: string;
    prompt: string;
    cron: string;
    timezone: string;
    status?: "active" | "paused";
}

export interface UpdateAgentScheduleInput {
    name?: string;
    prompt?: string;
    cron?: string;
    timezone?: string;
    status?: "active" | "paused";
}

function scheduleInput(schedule: WorkflowSchedule): ScheduleInput | null {
    const value = schedule.inputData;
    if (!value || typeof value !== "object") return null;
    const input = value as Record<string, unknown>;
    if (
        typeof input.agentId !== "string" ||
        typeof input.ownerId !== "string" ||
        typeof input.name !== "string" ||
        typeof input.prompt !== "string"
    ) {
        return null;
    }
    return {
        agentId: input.agentId,
        ownerId: input.ownerId,
        name: input.name,
        prompt: input.prompt,
    };
}

function isOwnedWorkflowSchedule(
    schedule: AnySchedule,
    owner: ScheduleOwner,
): schedule is WorkflowSchedule {
    const input = schedule.workflowId === DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID
        ? scheduleInput(schedule)
        : null;
    return (
        input !== null &&
        schedule.metadata?.[HYROS_AGENT_ID] === owner.agentId &&
        schedule.metadata?.[HYROS_OWNER_ID] === owner.ownerId &&
        input.agentId === owner.agentId &&
        input.ownerId === owner.ownerId
    );
}

function toIso(value: number | undefined): string | null {
    return value === undefined ? null : new Date(value).toISOString();
}

function toSummary(schedule: WorkflowSchedule): AgentScheduleSummary {
    const input = scheduleInput(schedule);
    if (!input) throw new Error(`schedule ${schedule.id} has invalid Hyros input`);
    return {
        id: schedule.id,
        name: input.name,
        prompt: input.prompt,
        cron: schedule.cron,
        timezone: schedule.timezone ?? null,
        status: schedule.status,
        nextFireAt: toIso(schedule.nextFireAt),
        lastFireAt: toIso(schedule.lastFireAt),
    };
}

async function ownedSchedule(
    mastra: Mastra,
    owner: ScheduleOwner,
    scheduleId: string,
): Promise<WorkflowSchedule> {
    const schedule = await mastra.schedules.get(scheduleId);
    if (!schedule || !isOwnedWorkflowSchedule(schedule, owner)) {
        throw new Error("schedule not found");
    }
    return schedule;
}

export async function createAgentSchedule(
    mastra: Mastra,
    owner: ScheduleOwner,
    input: CreateAgentScheduleInput,
): Promise<AgentScheduleSummary> {
    const scheduleInputValue: ScheduleInput = { ...owner, name: input.name, prompt: input.prompt };
    const schedule = await mastra.schedules.create({
        workflowId: DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID,
        cron: input.cron,
        timezone: input.timezone,
        status: input.status,
        inputData: scheduleInputValue,
        metadata: {
            [HYROS_AGENT_ID]: owner.agentId,
            [HYROS_OWNER_ID]: owner.ownerId,
        },
    });
    return toSummary(schedule);
}

export async function listAgentSchedules(
    mastra: Mastra,
    owner: ScheduleOwner,
): Promise<AgentScheduleSummary[]> {
    const schedules = await mastra.schedules.list({
        workflowId: DYNAMIC_AGENT_SCHEDULE_WORKFLOW_ID,
    });
    return schedules
        .filter((schedule) => isOwnedWorkflowSchedule(schedule, owner))
        .map(toSummary)
        .sort((a, b) => (a.nextFireAt ?? "").localeCompare(b.nextFireAt ?? ""));
}

export async function updateAgentSchedule(
    mastra: Mastra,
    owner: ScheduleOwner,
    scheduleId: string,
    patch: UpdateAgentScheduleInput,
): Promise<AgentScheduleSummary> {
    const current = await ownedSchedule(mastra, owner, scheduleId);
    const currentInput = scheduleInput(current)!;
    const updated = await mastra.schedules.update(scheduleId, {
        ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        inputData: {
            ...currentInput,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        },
        metadata: current.metadata,
    });
    if (updated.workflowId === undefined) throw new Error("updated schedule changed type");
    return toSummary(updated);
}

export async function deleteAgentSchedule(
    mastra: Mastra,
    owner: ScheduleOwner,
    scheduleId: string,
): Promise<void> {
    await ownedSchedule(mastra, owner, scheduleId);
    await mastra.schedules.delete(scheduleId);
}

export async function deleteAllAgentSchedules(
    mastra: Mastra,
    owner: ScheduleOwner,
): Promise<number> {
    const schedules = await listAgentSchedules(mastra, owner);
    await Promise.all(schedules.map((schedule) => mastra.schedules.delete(schedule.id)));
    return schedules.length;
}
