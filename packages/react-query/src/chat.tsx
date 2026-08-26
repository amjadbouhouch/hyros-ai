/**
 * Shared web/desktop chat wiring (TASK-026): the zustand chat store + the
 * agents TanStack Query cache, mapped onto @hyros-ai/ui's MessagingApp props.
 *
 * The store is a singleton per createHyrosChat() call (one EventSource
 * fan-out per agent, shared by every hook consumer). Platform differences are
 * injected: gateway URL, auth headers, and the EventSource factory — SSE can't
 * carry headers in browsers, so desktop rides the ?token= query param while
 * web uses the browser default with no token. Dev fallback: no token → the
 * gateway's DEV_USER_ID.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    createChatStore,
    projectChatMessages,
    type AgentChatView,
    type ChatMessageView,
    type ChatStoreState,
    type ChatTraceEvent,
    type EventSourceLike,
} from "@hyros-ai/client-runtime";

import {
    agentQueryKeys,
    useAgentsQuery,
    useArchiveAgentMutation,
    useCreateAgentMutation,
} from "./agents.js";
import { useHyrosQueryClient } from "./client.js";
import { scheduleQueryKeys, schedulesQueryOptions } from "./schedules.js";
import {
    createAgentsHttpTransport,
    type AgentQueryTransport,
    type AgentSummary,
} from "./transport.js";

const EMPTY_AGENTS: AgentSummary[] = [];

/** Trace-ish event that has not been stamped with an agent id yet. */
export type HyrosChatTraceEvent =
    | ChatTraceEvent
    | (Omit<ChatTraceEvent, "agentId"> & { agentId?: string });

export interface HyrosChatOptions {
    /** Gateway base URL; defaults to the local dev gateway. */
    baseUrl?: string;
    /** Auth headers for POST/PATCH requests (SSE never carries them). */
    getHeaders?: () => Record<string, string>;
    /**
     * EventSource factory. Browsers get a default bridge over the global
     * EventSource; desktop injects one that appends ?token=.
     */
    createEventSource?: (url: string) => EventSourceLike;
    /**
     * Rewrite the SSE URL before the default bridge opens it — desktop sets
     * the ?token= query param here because SSE cannot carry headers.
     */
    sseUrl?: (url: string) => string;
    onTrace?: (event: HyrosChatTraceEvent) => void;
}

function defaultTrace(event: HyrosChatTraceEvent): void {
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

function defaultCreateEventSource(url: string): EventSourceLike {
    const es = new EventSource(url);
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
}

function bridgedEventSource(
    sseUrl: ((url: string) => string) | undefined,
): (url: string) => EventSourceLike {
    return (url) => defaultCreateEventSource(sseUrl ? sseUrl(url) : url);
}

/**
 * Fold the persisted agents list (TanStack Query cache) and the live SSE state
 * (chat store) into the Chat views MessagingApp renders. Pure so hosts can
 * test it without React.
 */
export function projectChats(
    agents: AgentSummary[],
    liveState: ChatStoreState,
): AgentChatView[] {
    return agents.map((a) => {
        const live = liveState.agents[a.id];
        const visibleMessages = projectChatMessages(live?.messages ?? []);
        // The list preview is what was said to the user, so it skips
        // collapsed agent-to-agent rows.
        const liveLast = visibleMessages
            .filter((item): item is ChatMessageView => item.kind === "message")
            .at(-1);
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
    });
}

/**
 * Build the app-scoped chat controller. Call once per app (module scope), then
 * mount `useHyrosChat` under a HyrosQueryClientProvider.
 */
export function createHyrosChat(options: HyrosChatOptions = {}) {
    const baseUrl = options.baseUrl ?? "http://localhost:3000";
    const getHeaders = options.getHeaders ?? (() => ({}));
    const createEventSource =
        options.createEventSource ?? bridgedEventSource(options.sseUrl);
    const trace = options.onTrace ?? defaultTrace;

    const chatStore = createChatStore({
        baseUrl,
        createEventSource,
        getHeaders,
        onTrace: trace,
    });

    const agentsHttpTransport = createAgentsHttpTransport({
        baseUrl,
        getHeaders,
        onTrace: trace,
    });

    const agentQueryTransport: AgentQueryTransport = {
        ...agentsHttpTransport,
        createAgent: ({ agentId, message }) =>
            chatStore.createAgent(message, agentId),
        archiveAgent: async (agentId) => {
            const result = await agentsHttpTransport.archiveAgent(agentId);
            chatStore.detach(result.id);
            return result;
        },
    };

    /** Drop every user-scoped chat stream/state entry during sign-out. */
    function resetHyrosChat(): void {
        chatStore.reset();
    }

    function useHyrosChat(ownerId: string) {
        const queryClient = useHyrosQueryClient();
        const agentsQuery = useAgentsQuery(ownerId, agentQueryTransport);
        const createAgentMutation = useCreateAgentMutation(
            ownerId,
            agentQueryTransport,
        );
        const archiveAgentMutation = useArchiveAgentMutation(
            ownerId,
            agentQueryTransport,
        );
        const agents = agentsQuery.data ?? EMPTY_AGENTS;
        const [state, setState] = useState(chatStore.store.getState());
        const pendingAgentIds = useRef(new Set<string>());
        const deferredAttachIds = useRef(new Set<string>());
        const previousRunning = useRef<Record<string, boolean>>({});

        useEffect(() => chatStore.store.subscribe(setState), []);

        // A completed/suspended run changes the persisted list preview and can
        // change the agent profile during onboarding. Mark the query stale so
        // the cache refreshes from the gateway while SSE remains the live
        // state owner.
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
                void queryClient.invalidateQueries({
                    queryKey: agentQueryKeys.list(ownerId),
                });
                for (const agentId of completedAgentIds) {
                    void queryClient.invalidateQueries({
                        queryKey: scheduleQueryKeys.list(ownerId, agentId),
                    });
                }
            }
        }, [ownerId, queryClient, state.agents]);

        const chats = useMemo(
            () => projectChats(agents, state),
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
                        // A selection made while the POST was in flight was
                        // deferred — attach now that the agent exists.
                        if (deferredAttachIds.current.delete(agentId)) {
                            chatStore.attach(agentId);
                        }
                    },
                },
            );
            return agentId;
        }

        function selectAgent(agentId: string) {
            // React Query begins mutations asynchronously. Attaching during
            // that window would open SSE before POST /chat creates the agent,
            // so the selection is remembered and attached on settle.
            if (pendingAgentIds.current.has(agentId)) {
                deferredAttachIds.current.add(agentId);
                return;
            }
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
            queryClient.removeQueries({
                queryKey: scheduleQueryKeys.list(ownerId, agentId),
            });
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

    return { useHyrosChat, resetHyrosChat, chatStore, agentQueryTransport };
}
