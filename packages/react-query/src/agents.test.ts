import { describe, expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";

import {
    agentQueryKeys,
    agentsQueryOptions,
    archiveAgentMutationOptions,
    createAgentMutationOptions,
} from "./agents.js";
import {
    createAgentsHttpTransport,
    HyrosQueryHttpError,
    type AgentSummary,
    type AgentQueryTransport,
} from "./transport.js";

describe("agent query transport", () => {
    test("uses the owner-scoped query cache while data is fresh", async () => {
        let calls = 0;
        const transport: AgentQueryTransport = {
            listSchedules: async () => [],
            listAgents: async () => {
                calls += 1;
                return [];
            },
            createAgent: async ({ agentId }) => agentId,
            archiveAgent: async (agentId) => ({
                id: agentId,
                archivedAt: "2026-08-16T00:00:00.000Z",
            }),
        };
        const client = new QueryClient();

        await client.fetchQuery(agentsQueryOptions("owner-a", transport));
        await client.fetchQuery(agentsQueryOptions("owner-a", transport));
        await client.fetchQuery(agentsQueryOptions("owner-b", transport));

        expect(calls).toBe(2);
    });

    test("optimistically creates and rolls back only the failed agent", async () => {
        const ownerId = "owner-a";
        const existing: AgentSummary = {
            id: "existing",
            name: "Existing",
            description: null,
            avatarUrl: null,
            lastMessage: null,
            createdAt: "2026-08-16T00:00:00.000Z",
        };
        const optimistic: AgentSummary = {
            ...existing,
            id: "optimistic",
            name: "New agent",
        };
        const transport: AgentQueryTransport = {
            listSchedules: async () => [],
            listAgents: async () => [existing],
            createAgent: async () => {
                throw new Error("create failed");
            },
            archiveAgent: async (agentId) => ({
                id: agentId,
                archivedAt: "2026-08-16T00:00:00.000Z",
            }),
        };
        const client = new QueryClient();
        const queryKey = agentQueryKeys.list(ownerId);
        client.setQueryData(queryKey, [existing]);
        const mutation = new MutationObserver(
            client,
            createAgentMutationOptions(ownerId, transport),
        );

        await expect(
            mutation.mutate({ agentId: optimistic.id, optimisticAgent: optimistic }),
        ).rejects.toThrow("create failed");

        expect(client.getQueryData<AgentSummary[]>(queryKey)).toEqual([existing]);
    });

    test("waits for an in-flight list cancellation before publishing an optimistic agent", async () => {
        const ownerId = "owner-a";
        const existing: AgentSummary = {
            id: "existing",
            name: "Existing",
            description: null,
            avatarUrl: null,
            lastMessage: null,
            createdAt: "2026-08-16T00:00:00.000Z",
        };
        const optimistic: AgentSummary = {
            ...existing,
            id: "optimistic",
            name: "New agent",
        };
        const transport: AgentQueryTransport = {
            listSchedules: async () => [],
            listAgents: async () => [existing],
            createAgent: async ({ agentId }) => agentId,
            archiveAgent: async (agentId) => ({
                id: agentId,
                archivedAt: "2026-08-16T00:00:00.000Z",
            }),
        };
        const client = new QueryClient();
        const queryKey = agentQueryKeys.list(ownerId);
        client.setQueryData(queryKey, [existing]);
        const originalCancel = client.cancelQueries.bind(client);
        let finishCancellation: (() => void) | undefined;
        const cancellation = new Promise<void>((resolve) => {
            finishCancellation = resolve;
        });
        client.cancelQueries = async (filters, options) => {
            await cancellation;
            return originalCancel(filters, options);
        };
        const mutation = new MutationObserver(
            client,
            createAgentMutationOptions(ownerId, transport),
        );

        const creating = mutation.mutate({
            agentId: optimistic.id,
            optimisticAgent: optimistic,
        });
        await Promise.resolve();
        expect(client.getQueryData<AgentSummary[]>(queryKey)).toEqual([existing]);

        finishCancellation?.();
        await creating;
        expect(client.getQueryData<AgentSummary[]>(queryKey)?.[0]?.id).toBe("optimistic");
    });

    test("removes an archived agent from the shared cache", async () => {
        const ownerId = "owner-a";
        const agent: AgentSummary = {
            id: "agent-1",
            name: "Agent",
            description: null,
            avatarUrl: null,
            lastMessage: null,
            createdAt: "2026-08-16T00:00:00.000Z",
        };
        const transport: AgentQueryTransport = {
            listSchedules: async () => [],
            listAgents: async () => [agent],
            createAgent: async ({ agentId }) => agentId,
            archiveAgent: async (agentId) => ({
                id: agentId,
                archivedAt: "2026-08-16T00:00:00.000Z",
            }),
        };
        const client = new QueryClient();
        const queryKey = agentQueryKeys.list(ownerId);
        client.setQueryData(queryKey, [agent]);
        const mutation = new MutationObserver(
            client,
            archiveAgentMutationOptions(ownerId, transport),
        );

        await mutation.mutate(agent.id);

        expect(client.getQueryData<AgentSummary[]>(queryKey)).toEqual([]);
    });

    test("sends auth, trace, and PATCH through the injected transport", async () => {
        const requests: { url: string; init?: RequestInit }[] = [];
        const transport = createAgentsHttpTransport({
            baseUrl: "http://gateway.test/",
            getHeaders: () => ({ Authorization: "Bearer token" }),
            createTraceId: () => "trace-1",
            fetchFn: (async (input, init) => {
                requests.push({ url: String(input), init });
                return Response.json({
                    id: "agent-1",
                    archivedAt: "2026-08-16T00:00:00.000Z",
                });
            }) as typeof fetch,
        });

        await transport.archiveAgent("agent-1");

        expect(requests[0]?.url).toBe("http://gateway.test/agents/agent-1/archive");
        expect(requests[0]?.init?.method).toBe("PATCH");
        const headers = new Headers(requests[0]?.init?.headers);
        expect(headers.get("authorization")).toBe("Bearer token");
        expect(headers.get("x-hyros-trace-id")).toBe("trace-1");
    });

    test("surfaces typed HTTP failures without retry ambiguity", async () => {
        const transport = createAgentsHttpTransport({
            baseUrl: "http://gateway.test",
            fetchFn: (async () =>
                Response.json(
                    { error: "agent not found" },
                    { status: 404 },
                )) as unknown as typeof fetch,
        });

        try {
            await transport.archiveAgent("missing");
            throw new Error("expected archive to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(HyrosQueryHttpError);
            expect((error as HyrosQueryHttpError).status).toBe(404);
            expect((error as Error).message).toBe("agent not found");
        }
    });

    test("loads an authenticated agent-scoped schedule list", async () => {
        const requests: { url: string; init?: RequestInit }[] = [];
        const transport = createAgentsHttpTransport({
            baseUrl: "http://gateway.test",
            getHeaders: () => ({ Authorization: "Bearer token" }),
            createTraceId: () => "trace-schedules",
            fetchFn: (async (input, init) => {
                requests.push({ url: String(input), init });
                return Response.json([]);
            }) as typeof fetch,
        });

        expect(await transport.listSchedules("agent-1")).toEqual([]);
        expect(requests[0]?.url).toBe("http://gateway.test/agents/agent-1/schedules");
        const headers = new Headers(requests[0]?.init?.headers);
        expect(headers.get("authorization")).toBe("Bearer token");
        expect(headers.get("x-hyros-trace-id")).toBe("trace-schedules");
    });
});
