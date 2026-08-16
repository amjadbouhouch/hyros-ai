/**
 * Desktop chat wiring (TASK-026): the shared zustand chat store + the agents
 * TanStack Query cache, mapped onto @hyros-ai/ui's MessagingApp props.
 *
 * The store is a module singleton (one EventSource fan-out per agent, shared by
 * every hook consumer). SSE can't carry headers in browsers, so the access
 * token rides the ?token= query param (gateway guard accepts it); POST /chat
 * uses a Bearer header. Dev fallback: no token → the gateway's DEV_USER_ID.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    createChatStore,
    projectChatMessages,
    type AgentChatView,
    type ChatTraceEvent,
    type EventSourceLike,
} from "@hyros-ai/client-runtime";
import {
    agentQueryKeys,
    createAgentsHttpTransport,
    scheduleQueryKeys,
    schedulesQueryOptions,
    useAgentsQuery,
    useArchiveAgentMutation,
    useCreateAgentMutation,
    useHyrosQueryClient,
    type AgentQueryTransport,
    type AgentSummary,
} from "@hyros-ai/react-query";
import { getAccessToken } from "./auth.js";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:3000";
const EMPTY_AGENTS: AgentSummary[] = [];

function trace(event: ChatTraceEvent | (Omit<ChatTraceEvent, "agentId"> & { agentId?: string })) {
    const data = {
        traceId: event.traceId,
        agentId: event.agentId ?? "list",
        status: event.status,
        ok: event.ok,
        detail: event.detail,
    };
    const write = event.event.endsWith(".error") ? console.error : console.info;
    write(`[CHAT-TRACE] ${event.event}`, data);
}

function authHeaders(): Record<string, string> {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

const chatStore = createChatStore({
    baseUrl: GATEWAY_URL,
    createEventSource: (url) => {
        const eventsUrl = new URL(url);
        eventsUrl.searchParams.set("token", getAccessToken() ?? "");
        const es = new EventSource(eventsUrl.toString());
        // Bridge the DOM MessageEvent onto the store's DOM-free { data } shape.
        const bridge: EventSourceLike = {
            onmessage: null,
            get readyState() {
                return es.readyState;
            },
            close: () => es.close(),
        };
        es.onopen = () => bridge.onopen?.();
        es.onerror = (ev) => bridge.onerror?.(ev);
        es.onmessage = (ev) => bridge.onmessage?.({ data: String(ev.data) });
        return bridge;
    },
    getHeaders: authHeaders,
    onTrace: trace,
});

const agentsHttpTransport = createAgentsHttpTransport({
    baseUrl: GATEWAY_URL,
    getHeaders: authHeaders,
    onTrace: trace,
});

const agentQueryTransport: AgentQueryTransport = {
    ...agentsHttpTransport,
    createAgent: ({ agentId, message }) => chatStore.createAgent(message, agentId),
    archiveAgent: async (agentId) => {
        const result = await agentsHttpTransport.archiveAgent(agentId);
        chatStore.detach(result.id);
        return result;
    },
};

/** Drop every user-scoped chat stream/state entry during sign-out. */
export function resetHyrosChat(): void {
    chatStore.reset();
}

export function useHyrosChat(ownerId: string) {
    const queryClient = useHyrosQueryClient();
    const agentsQuery = useAgentsQuery(ownerId, agentQueryTransport);
    const createAgentMutation = useCreateAgentMutation(ownerId, agentQueryTransport);
    const archiveAgentMutation = useArchiveAgentMutation(ownerId, agentQueryTransport);
    const agents = agentsQuery.data ?? EMPTY_AGENTS;
    const [state, setState] = useState(chatStore.store.getState());
    const pendingAgentIds = useRef(new Set<string>());
    const previousRunning = useRef<Record<string, boolean>>({});

    useEffect(() => chatStore.store.subscribe(setState), []);

    // A completed/suspended run changes the persisted list preview and can
    // change the agent profile during onboarding. Mark the query stale so the
    // cache refreshes from the gateway while SSE remains the live-state owner.
    useEffect(() => {
        const completedAgentIds: string[] = [];
        const nextRunning: Record<string, boolean> = {};
        for (const [agentId, live] of Object.entries(state.agents)) {
            nextRunning[agentId] = live.running;
            if (previousRunning.current[agentId] && !live.running) {
                completedAgentIds.push(agentId);
            }
        }
        previousRunning.current = nextRunning;
        if (completedAgentIds.length > 0) {
            void queryClient.invalidateQueries({ queryKey: agentQueryKeys.list(ownerId) });
            for (const agentId of completedAgentIds) {
                void queryClient.invalidateQueries({
                    queryKey: scheduleQueryKeys.list(ownerId, agentId),
                });
            }
        }
    }, [ownerId, queryClient, state.agents]);

    const chats: AgentChatView[] = useMemo(
        () =>
            agents.map((a) => {
                const live = state.agents[a.id];
                const visibleMessages = projectChatMessages(live?.messages ?? []);
                const liveLast = visibleMessages.at(-1);
                return {
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    avatarUrl: a.avatarUrl,
                    running: live?.running ?? false,
                    pendingQuestion: live?.pendingQuestion ?? null,
                    lastMessage: liveLast
                        ? {
                              text: liveLast.text,
                              role: liveLast.role === "assistant" ? "agent" : "user",
                              createdAt: liveLast.createdAt,
                          }
                        : a.lastMessage,
                    messages: visibleMessages,
                };
            }),
        [agents, state],
    );

    function createAgent(): string {
        const agentId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        pendingAgentIds.current.add(agentId);
        createAgentMutation.mutate(
            {
                agentId,
                optimisticAgent: {
                    id: agentId,
                    name: "New agent",
                    description: null,
                    avatarUrl: null,
                    lastMessage: null,
                    createdAt,
                },
            },
            {
                onError: (error) => {
                    trace({
                        traceId: chatStore.getTraceId(agentId),
                        agentId,
                        event: "create.error",
                        detail: String(error),
                    });
                },
                onSettled: () => {
                    pendingAgentIds.current.delete(agentId);
                },
            },
        );
        return agentId;
    }

    function selectAgent(agentId: string) {
        // React Query begins mutations asynchronously. This guard keeps an
        // optimistic selection from opening SSE before POST /chat creates it.
        if (pendingAgentIds.current.has(agentId)) return;
        chatStore.attach(agentId);
    }

    function sendMessage(agentId: string, text: string) {
        void chatStore.send(agentId, text).catch((error) => {
            trace({
                traceId: chatStore.getTraceId(agentId),
                agentId,
                event: "send.error",
                detail: String(error),
            });
        });
    }

    async function archiveAgent(agentId: string): Promise<void> {
        await archiveAgentMutation.mutateAsync(agentId);
        queryClient.removeQueries({ queryKey: scheduleQueryKeys.list(ownerId, agentId) });
    }

    const loadSchedules = useCallback(
        (agentId: string) =>
            queryClient.fetchQuery(
                schedulesQueryOptions(ownerId, agentId, agentQueryTransport),
            ),
        [ownerId, queryClient],
    );

    return {
        chats,
        creating: createAgentMutation.isPending,
        createAgent,
        selectAgent,
        sendMessage,
        archiveAgent,
        loadSchedules,
    };
}
