import { queryOptions } from "@tanstack/react-query";

import type { AgentQueryTransport } from "./transport.js";

export const scheduleQueryKeys = {
    all: ["agent-schedules"] as const,
    list: (ownerId: string, agentId: string) =>
        ["agent-schedules", "list", ownerId, agentId] as const,
};

export function schedulesQueryOptions(
    ownerId: string,
    agentId: string,
    transport: AgentQueryTransport,
) {
    return queryOptions({
        queryKey: scheduleQueryKeys.list(ownerId, agentId),
        queryFn: ({ signal }) => transport.listSchedules(agentId, { signal }),
        staleTime: 30_000,
    });
}
