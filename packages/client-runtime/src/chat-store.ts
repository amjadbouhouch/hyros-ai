/**
 * @hyros-ai/client-runtime — chat store (zustand, vanilla).
 *
 * Shared chat state for every client (web, desktop, mobile): per-agent message
 * lists, pending ask_user questions, and run status. Mirrors the gateway's
 * chat surface exactly:
 *   - POST /chat is fire-and-forget (200 empty) — runs live server-side.
 *   - GET /chat/:agentId/events (SSE) is the single subscription channel;
 *     attach() folds its events into the store.
 *
 * Platform rules (same as session.ts): no DOM/Node APIs — EventSource is
 * injected (mobile supplies a polyfill), fetch/uuid come from globalThis.
 * Auth headers are injected; note SSE can't carry headers in browsers, so
 * authenticated deployments pass the token via the EventSource factory
 * (e.g. query param) — dev works without via the gateway's DEV_USER_ID.
 */

import { createStore } from "zustand/vanilla";

import type {
    ChatEvent,
    ChatMessagesResponse,
    ChatPostBody,
} from "@hyros-ai/api-client";
import type {
    ChatMessageDto,
    ChatQuestion,
    ChatQuestionOption,
} from "@hyros-ai/domain";
import { messageCreatedAt } from "./chat-messages.js";

export type PendingQuestion = ChatQuestion;

export interface AgentChatState {
    threadId: string | null;
    messages: ChatMessageDto[];
    pendingQuestion: PendingQuestion | null;
    running: boolean;
    attached: boolean;
}

export interface ChatStoreState {
    agents: Record<string, AgentChatState>;
}

/** Minimal EventSource surface we rely on (server sends unnamed data: lines). */
export interface EventSourceLike {
    onmessage: ((ev: { data: string }) => void) | null;
    onopen?: (() => void) | null;
    onerror?: ((ev: unknown) => void) | null;
    /** EventSource.CLOSED is 2; optional for non-browser polyfills. */
    readonly readyState?: number;
    close(): void;
}

export interface ChatTraceEvent {
    traceId: string;
    agentId: string;
    event: string;
    status?: number;
    ok?: boolean;
    detail?: string;
}

export interface ChatStoreOptions {
    /** Gateway base URL, e.g. http://localhost:3000. */
    baseUrl: string;
    /** Platform EventSource (web/desktop: globalThis.EventSource). */
    createEventSource: (url: string) => EventSourceLike;
    /** Extra headers for POST /chat (e.g. Bearer token). */
    getHeaders?: () => Record<string, string>;
    /** Injectable fetch for deterministic transport tests. */
    fetchFn?: typeof globalThis.fetch;
    /** Structured transport diagnostics; hosts decide where to write them. */
    onTrace?: (event: ChatTraceEvent) => void;
    /** Injectable UUID source for deterministic tests. */
    createTraceId?: () => string;
}

const EMPTY_AGENT: AgentChatState = {
    threadId: null,
    messages: [],
    pendingQuestion: null,
    running: false,
    attached: false,
};

export function createChatStore(options: ChatStoreOptions) {
    const {
        baseUrl,
        createEventSource,
        getHeaders,
        fetchFn = globalThis.fetch,
        onTrace,
        createTraceId = () => crypto.randomUUID(),
    } = options;
    const sources = new Map<string, EventSourceLike>();
    const traceIds = new Map<string, string>();
    const creations = new Map<string, Promise<void>>();
    let lifecycle = 0;

    const store = createStore<ChatStoreState>(() => ({ agents: {} }));

    function traceIdFor(agentId: string): string {
        const existing = traceIds.get(agentId);
        if (existing) return existing;
        const created = createTraceId();
        traceIds.set(agentId, created);
        return created;
    }

    function trace(agentId: string, event: string, data: Omit<ChatTraceEvent, "traceId" | "agentId" | "event"> = {}) {
        onTrace?.({ traceId: traceIdFor(agentId), agentId, event, ...data });
    }

    function patch(agentId: string, partial: Partial<AgentChatState>) {
        store.setState((s) => ({
            agents: {
                ...s.agents,
                [agentId]: { ...(s.agents[agentId] ?? EMPTY_AGENT), ...partial },
            },
        }));
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    function isChatMessage(value: unknown): value is ChatMessageDto {
        if (!isRecord(value)) return false;
        if (typeof value.id !== "string") return false;
        if (
            value.role !== "system" &&
            value.role !== "user" &&
            value.role !== "assistant"
        ) return false;
        if (!Array.isArray(value.parts)) return false;
        return value.parts.every(
            (part) => isRecord(part) && typeof part.type === "string",
        );
    }

    function isChatHistory(value: unknown): value is ChatMessagesResponse {
        return Array.isArray(value) && value.every(isChatMessage);
    }

    function parseQuestion(value: unknown): ChatQuestion | null {
        if (!isRecord(value)) return null;
        if (typeof value.toolCallId !== "string" || typeof value.question !== "string") {
            return null;
        }
        if (
            value.selectionMode !== undefined &&
            value.selectionMode !== "single_select" &&
            value.selectionMode !== "multi_select"
        ) {
            return null;
        }
        let options: ChatQuestionOption[] | undefined;
        if (value.options !== undefined) {
            if (!Array.isArray(value.options)) return null;
            options = [];
            for (const option of value.options) {
                if (
                    !isRecord(option) ||
                    typeof option.label !== "string" ||
                    (option.description !== undefined &&
                        typeof option.description !== "string")
                ) {
                    return null;
                }
                options.push({
                    label: option.label,
                    ...(option.description === undefined
                        ? {}
                        : { description: option.description }),
                });
            }
        }
        return {
            toolCallId: value.toolCallId,
            question: value.question,
            options,
            selectionMode: value.selectionMode,
        };
    }

    function parseEvent(value: unknown): ChatEvent | null {
        if (!isRecord(value) || typeof value.type !== "string") return null;
        switch (value.type) {
            case "session":
                return typeof value.agentId === "string" &&
                    typeof value.threadId === "string"
                    ? {
                          type: "session",
                          agentId: value.agentId,
                          threadId: value.threadId,
                      }
                    : null;
            case "snapshot": {
                if (typeof value.running !== "boolean") return null;
                const pendingQuestion =
                    value.pendingQuestion === null
                        ? null
                        : parseQuestion(value.pendingQuestion);
                if (value.pendingQuestion !== null && !pendingQuestion) return null;
                return { type: "snapshot", running: value.running, pendingQuestion };
            }
            case "message":
                return isChatMessage(value.message)
                    ? { type: "message", message: value.message }
                    : null;
            case "ask_user": {
                const question = parseQuestion(value);
                return question ? { type: "ask_user", ...question } : null;
            }
            case "done":
                return { type: "done" };
            case "error":
                return typeof value.message === "string"
                    ? { type: "error", message: value.message }
                    : null;
            default:
                return null;
        }
    }

    function handleEvent(agentId: string, ev: ChatEvent) {
        trace(agentId, "sse.event", { detail: ev.type });
        switch (ev.type) {
            case "session":
                patch(agentId, { threadId: ev.threadId });
                break;
            case "snapshot": {
                // Reopen/reattach hydration: running state + a parked ask_user
                // question that survived a server restart.
                patch(agentId, {
                    running: ev.running,
                    pendingQuestion: ev.pendingQuestion,
                });
                break;
            }
            case "message": {
                const message = ev.message;
                const cur = store.getState().agents[agentId] ?? EMPTY_AGENT;
                const rest = cur.messages.filter((m) => m.id !== message.id);
                patch(agentId, {
                    messages: [...rest, message].sort((a, b) =>
                        messageCreatedAt(a).localeCompare(messageCreatedAt(b)),
                    ),
                });
                break;
            }
            case "ask_user": {
                patch(agentId, {
                    pendingQuestion: {
                        toolCallId: ev.toolCallId,
                        question: ev.question,
                        options: ev.options,
                        selectionMode: ev.selectionMode,
                    },
                    running: false,
                });
                break;
            }
            case "done":
                patch(agentId, { running: false });
                break;
            case "error":
                patch(agentId, { running: false });
                break;
        }
    }

    async function post(body: ChatPostBody, generation: number = lifecycle): Promise<void> {
        const agentId = String(body.agentId ?? "unknown");
        const traceId = traceIdFor(agentId);
        trace(agentId, "post.start");
        try {
            const res = await fetchFn(`${baseUrl}/chat`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-hyros-trace-id": traceId,
                    ...getHeaders?.(),
                },
                body: JSON.stringify(body),
            });
            if (generation === lifecycle) {
                trace(agentId, "post.response", {
                    status: res.status,
                    ok: res.ok,
                    detail: `content-length=${res.headers.get("content-length") ?? "unset"} bodyUsed=${res.bodyUsed}`,
                });
            }
            if (!res.ok) throw new Error(`POST /chat failed: ${res.status}`);
        } catch (error) {
            if (generation === lifecycle) {
                trace(agentId, "post.error", { detail: String(error) });
            }
            throw error;
        }
    }

    /** Load persisted history and merge with any live messages (live wins). */
    async function loadHistory(agentId: string) {
        const generation = lifecycle;
        const traceId = traceIdFor(agentId);
        trace(agentId, "history.start");
        const res = await fetchFn(`${baseUrl}/chat/${agentId}/messages`, {
            headers: { "x-hyros-trace-id": traceId, ...getHeaders?.() },
        });
        if (generation !== lifecycle) return;
        trace(agentId, "history.response", { status: res.status, ok: res.ok });
        if (!res.ok) return; // history is best-effort; live stream still works
        const payload: unknown = await res.json();
        if (!isChatHistory(payload)) return;
        const history = payload;
        const cur = store.getState().agents[agentId] ?? EMPTY_AGENT;
        const live = new Map(cur.messages.map((m) => [m.id, m]));
        const merged = [
            ...history.filter((h) => !live.has(h.id)),
            ...cur.messages,
        ].sort((a, b) => messageCreatedAt(a).localeCompare(messageCreatedAt(b)));
        patch(agentId, { messages: merged });
    }

    /** Subscribe to an agent's event stream + load its history (idempotent). */
    function attach(agentId: string) {
        if (creations.has(agentId)) {
            trace(agentId, "sse.defer", { detail: "agent creation pending" });
            return;
        }
        if (sources.has(agentId)) {
            trace(agentId, "sse.reuse");
            return;
        }
        const traceId = traceIdFor(agentId);
        const eventsUrl = `${baseUrl}/chat/${agentId}/events?traceId=${encodeURIComponent(traceId)}`;
        trace(agentId, "sse.connect");
        const es = createEventSource(eventsUrl);
        es.onopen = () => trace(agentId, "sse.open");
        es.onerror = () => {
            trace(agentId, "sse.error", { detail: `readyState=${es.readyState ?? "unknown"}` });
            // Native EventSource retries transient failures while CONNECTING
            // (0). A 404 closes it permanently (2); evict that dead instance
            // so a later attach/select can establish a fresh connection.
            if (es.readyState === 2 && sources.get(agentId) === es) {
                es.close();
                sources.delete(agentId);
                patch(agentId, { attached: false });
                trace(agentId, "sse.evicted");
            }
        };
        es.onmessage = (e) => {
            try {
                const event: unknown = JSON.parse(e.data);
                const parsed = parseEvent(event);
                if (parsed) handleEvent(agentId, parsed);
            } catch (error) {
                trace(agentId, "sse.invalid", { detail: String(error) });
            }
        };
        sources.set(agentId, es);
        patch(agentId, { attached: true });
        void loadHistory(agentId);
    }

    function detach(agentId: string) {
        trace(agentId, "sse.close");
        sources.get(agentId)?.close();
        sources.delete(agentId);
        patch(agentId, { attached: false });
    }

    /** Send a user message (or answer a pending ask_user question). */
    async function send(agentId: string, message: string) {
        const generation = lifecycle;
        const cur = store.getState().agents[agentId] ?? EMPTY_AGENT;
        const pendingToolCallId = cur.pendingQuestion?.toolCallId;
        const answeredQuestion = cur.pendingQuestion?.question;
        const optimisticId = crypto.randomUUID();
        patch(agentId, {
            messages: [
                ...cur.messages,
                {
                    id: optimisticId,
                    role: "user",
                    metadata: {
                        createdAt: new Date().toISOString(),
                        optimistic: true,
                        ...(pendingToolCallId ? { pendingToolCallId } : {}),
                        ...(pendingToolCallId && answeredQuestion
                            ? { answeredQuestion }
                            : {}),
                    },
                    parts: [{ type: "text", text: message }],
                },
            ],
            pendingQuestion: null,
            running: true,
        });
        try {
            await post({ agentId, message }, generation);
        } catch (error) {
            if (generation !== lifecycle) throw error;
            const latest = store.getState().agents[agentId] ?? EMPTY_AGENT;
            patch(agentId, {
                messages: latest.messages.filter((entry) => entry.id !== optimisticId),
                pendingQuestion: latest.pendingQuestion ?? cur.pendingQuestion,
                running: cur.running,
            });
            throw error;
        }
    }

    /**
     * Create a new agent (client-generated uuid — the POST is 200-empty and
     * idempotent on retry), kick off onboarding, and attach to its events.
     */
    async function createAgent(
        message?: string,
        agentId: string = crypto.randomUUID(),
    ): Promise<string> {
        const generation = lifecycle;
        patch(agentId, { running: true });
        const creation = post({ isNew: true, agentId, message }, generation);
        creations.set(agentId, creation);
        try {
            // The gateway creates the DB row in this request. Opening SSE or
            // history before it resolves races the row insert and returns 404.
            await creation;
        } catch (error) {
            if (generation === lifecycle) patch(agentId, { running: false });
            throw error;
        } finally {
            creations.delete(agentId);
        }
        if (generation === lifecycle) attach(agentId);
        return agentId;
    }

    /** Close authenticated transports and remove all user-scoped chat state. */
    function reset() {
        lifecycle += 1;
        for (const source of sources.values()) {
            source.onmessage = null;
            source.onopen = null;
            source.onerror = null;
            source.close();
        }
        sources.clear();
        traceIds.clear();
        creations.clear();
        store.setState({ agents: {} });
    }

    return { store, attach, detach, reset, send, createAgent, getTraceId: traceIdFor };
}

export type ChatStore = ReturnType<typeof createChatStore>;
