import {
    mutationOptions,
    queryOptions,
    useMutation,
    useQuery,
} from "@tanstack/react-query";
import type { AgentSummary } from "./transport.js";

import type { AgentQueryTransport, CreateAgentInput } from "./transport.js";

export interface CreateAgentMutationInput extends CreateAgentInput {
    optimisticAgent: AgentSummary;
}

export const agentQueryKeys = {
    all: ["agents"] as const,
    list: (ownerId: string) => ["agents", "list", ownerId] as const,
};

export const agentMutationKeys = {
    create: (ownerId: string) => ["agents", "create", ownerId] as const,
    archive: (ownerId: string) => ["agents", "archive", ownerId] as const,
};

export function agentsQueryOptions(ownerId: string, transport: AgentQueryTransport) {
    return queryOptions({
        queryKey: agentQueryKeys.list(ownerId),
        queryFn: ({ signal }) => transport.listAgents({ signal }),
        staleTime: 30_000,
    });
}

export function useAgentsQuery(ownerId: string, transport: AgentQueryTransport) {
    return useQuery(agentsQueryOptions(ownerId, transport));
}

/** Create with an immediate cache row; failures remove only that optimistic id. */
export function createAgentMutationOptions(
    ownerId: string,
    transport: AgentQueryTransport,
) {
    const queryKey = agentQueryKeys.list(ownerId);
    return mutationOptions({
        mutationKey: agentMutationKeys.create(ownerId),
        mutationFn: ({ agentId, message }: CreateAgentMutationInput) =>
            transport.createAgent({ agentId, message }),
        onMutate: async (variables, context) => {
            await context.client.cancelQueries({ queryKey });
            context.client.setQueryData<AgentSummary[]>(queryKey, (current = []) => [
                variables.optimisticAgent,
                ...current.filter((agent) => agent.id !== variables.agentId),
            ]);
        },
        onError: (_error, variables, _result, context) => {
            context.client.setQueryData<AgentSummary[]>(queryKey, (current = []) =>
                current.filter((agent) => agent.id !== variables.agentId),
            );
        },
        onSuccess: (_agentId, _variables, _result, context) =>
            context.client.invalidateQueries({ queryKey }),
    });
}

export function useCreateAgentMutation(ownerId: string, transport: AgentQueryTransport) {
    return useMutation(createAgentMutationOptions(ownerId, transport));
}

/** Archive updates the shared list cache only after the server confirms it. */
export function archiveAgentMutationOptions(
    ownerId: string,
    transport: AgentQueryTransport,
) {
    const queryKey = agentQueryKeys.list(ownerId);
    return mutationOptions({
        mutationKey: agentMutationKeys.archive(ownerId),
        mutationFn: (agentId: string) => transport.archiveAgent(agentId),
        onSuccess: (result, _agentId, _mutationResult, context) => {
            context.client.setQueryData<AgentSummary[]>(queryKey, (current = []) =>
                current.filter((agent) => agent.id !== result.id),
            );
            void context.client.invalidateQueries({ queryKey });
        },
    });
}

export function useArchiveAgentMutation(ownerId: string, transport: AgentQueryTransport) {
    return useMutation(archiveAgentMutationOptions(ownerId, transport));
}
