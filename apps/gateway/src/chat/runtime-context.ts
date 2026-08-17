import { RequestContext } from "@mastra/core/request-context";

import type { UserProfile } from "@hyros-ai/domain";
import type { AgentRow } from "./runtime.js";

/** JSON-safe identity available to every tool invoked by an agent run. */
export interface CurrentAgentContext {
    id: string;
    ownerId: string;
    name: string;
    slug: string | null;
    description: string | null;
    avatarUrl: string | null;
}

/** Extensible authenticated-user object available to every agent run. */
export type CurrentUserContext = UserProfile;

export interface HyrosRuntimeContextValues {
    currentAgent: CurrentAgentContext;
    currentUser: CurrentUserContext;
}

// Mastra's Session methods currently accept RequestContext<unknown>; keeping
// this alias unparameterized avoids generic invariance at that API boundary.
export type HyrosRuntimeContext = RequestContext;

export function toCurrentAgent(row: AgentRow): CurrentAgentContext {
    return {
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        slug: row.slug,
        description: row.description,
        avatarUrl: row.avatarUrl,
    };
}

export function createRuntimeContext(
    row: AgentRow,
    currentUser: CurrentUserContext,
): HyrosRuntimeContext {
    if (row.ownerId !== currentUser.id) {
        throw new Error("agent and currentUser must have the same owner");
    }
    const context = new RequestContext();
    context.set("currentAgent", toCurrentAgent(row));
    context.set("currentUser", { ...currentUser });
    return context;
}

export function readRuntimeIdentity(
    context: HyrosRuntimeContext,
    expectedAgentId: string,
): HyrosRuntimeContextValues {
    const currentAgent = context.get<string, CurrentAgentContext>("currentAgent");
    const currentUser = context.get<string, CurrentUserContext>("currentUser");
    if (!currentAgent || !currentUser) {
        throw new Error("currentAgent and currentUser are required in RequestContext");
    }
    if (currentAgent.id !== expectedAgentId) {
        throw new Error("RequestContext currentAgent does not match the running agent");
    }
    if (currentAgent.ownerId !== currentUser.id) {
        throw new Error("RequestContext currentAgent does not belong to currentUser");
    }
    return { currentAgent, currentUser };
}
