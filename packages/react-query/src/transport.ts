import {
    createApiClient,
    type AgentSummary,
    type ArchiveAgentResponse,
    type AgentSchedulesResponse,
    type ChatPostBody,
} from "@hyros-ai/api-client";

export type { AgentSchedulesResponse, AgentSummary, ArchiveAgentResponse } from "@hyros-ai/api-client";

export interface AgentQueryTraceEvent {
    traceId: string;
    agentId: string;
    event: "agents.start" | "agents.response" | "agents.error" | "archive.start" | "archive.response" | "archive.error";
    status?: number;
    ok?: boolean;
    detail?: string;
}

export interface CreateAgentInput {
    agentId: NonNullable<ChatPostBody["agentId"]>;
    message?: ChatPostBody["message"];
}

export interface AgentQueryTransport {
    listAgents(input?: { signal?: AbortSignal }): Promise<AgentSummary[]>;
    createAgent(input: CreateAgentInput): Promise<string>;
    archiveAgent(agentId: string): Promise<ArchiveAgentResponse>;
    listSchedules(agentId: string, input?: { signal?: AbortSignal }): Promise<AgentSchedulesResponse>;
}

export interface AgentsHttpTransportOptions {
    baseUrl: string;
    getHeaders?: () => Record<string, string>;
    fetchFn?: typeof globalThis.fetch;
    createTraceId?: () => string;
    onTrace?: (event: AgentQueryTraceEvent) => void;
}

export class HyrosQueryHttpError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = "HyrosQueryHttpError";
    }
}

function responseError(value: unknown, status: number, fallback: string): HyrosQueryHttpError {
    const message =
        typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "string"
            ? value.error
            : fallback;
    return new HyrosQueryHttpError(message, status);
}

/** Shared HTTP portion of the agent transport. Hosts inject auth and fetch. */
export function createAgentsHttpTransport(options: AgentsHttpTransportOptions): Pick<
    AgentQueryTransport,
    "listAgents" | "archiveAgent" | "listSchedules"
> {
    const {
        baseUrl,
        getHeaders,
        fetchFn = globalThis.fetch,
        createTraceId = () => crypto.randomUUID(),
        onTrace,
    } = options;
    const root = baseUrl.replace(/\/$/, "");
    const api = createApiClient(root, { fetcher: fetchFn });

    return {
        async listAgents({ signal } = {}) {
            const traceId = createTraceId();
            onTrace?.({ traceId, agentId: "list", event: "agents.start" });
            try {
                const result = await api.agents.get({
                    headers: {
                        "x-hyros-trace-id": traceId,
                        ...getHeaders?.(),
                    },
                    fetch: { signal },
                });
                onTrace?.({
                    traceId,
                    agentId: "list",
                    event: "agents.response",
                    status: result.status,
                    ok: result.response.ok,
                });
                if (result.error || !result.data) {
                    throw responseError(
                        result.error?.value ?? result.data,
                        result.status,
                        `Loading agents failed (${result.status})`,
                    );
                }
                return result.data;
            } catch (error) {
                if (!signal?.aborted) {
                    onTrace?.({
                        traceId,
                        agentId: "list",
                        event: "agents.error",
                        detail: String(error),
                    });
                }
                throw error;
            }
        },

        async archiveAgent(agentId) {
            const traceId = createTraceId();
            onTrace?.({ traceId, agentId, event: "archive.start" });
            try {
                const result = await api.agents({ agentId }).archive.patch(undefined, {
                    headers: {
                        "x-hyros-trace-id": traceId,
                        ...getHeaders?.(),
                    },
                });
                onTrace?.({
                    traceId,
                    agentId,
                    event: "archive.response",
                    status: result.status,
                    ok: result.response.ok,
                });
                if (result.error || !result.data) {
                    throw responseError(
                        result.error?.value ?? result.data,
                        result.status,
                        `Archiving agent failed (${result.status})`,
                    );
                }
                return result.data;
            } catch (error) {
                onTrace?.({
                    traceId,
                    agentId,
                    event: "archive.error",
                    detail: String(error),
                });
                throw error;
            }
        },

        async listSchedules(agentId, { signal } = {}) {
            const traceId = createTraceId();
            onTrace?.({ traceId, agentId, event: "agents.start", detail: "schedules" });
            try {
                const result = await api.agents({ agentId }).schedules.get({
                    headers: {
                        "x-hyros-trace-id": traceId,
                        ...getHeaders?.(),
                    },
                    fetch: { signal },
                });
                onTrace?.({
                    traceId,
                    agentId,
                    event: "agents.response",
                    status: result.status,
                    ok: result.response.ok,
                    detail: "schedules",
                });
                if (result.error || !result.data) {
                    throw responseError(
                        result.error?.value ?? result.data,
                        result.status,
                        `Loading schedules failed (${result.status})`,
                    );
                }
                return result.data;
            } catch (error) {
                if (!signal?.aborted) {
                    onTrace?.({
                        traceId,
                        agentId,
                        event: "agents.error",
                        detail: `schedules: ${String(error)}`,
                    });
                }
                throw error;
            }
        },
    };
}
