/**
 * Typed client for @hyros-ai/sandbox-service. Plain fetch, no Mastra — the
 * Mastra provider is built on top of this in hyros-sandbox.ts.
 *
 * The service is self-healing: every route but its two lookups starts or adopts
 * the organization's container if it is not up, and recovers the agent roster
 * from the volume. So this client has no reconnect logic and no retry loop —
 * there is nothing for it to orchestrate.
 *
 * One failure is worth handling by the caller rather than throwing blindly:
 * `AGENT_NOT_PROVISIONED` (409) means the agent has no directory yet. Call
 * `ensureAgent` and try again.
 */

export interface SandboxServiceOptions {
    /** Base URL of the service, e.g. http://localhost:3100 */
    url: string;
    /** Bearer token. Omitted only against a service running with auth disabled. */
    token?: string;
    /** Budget for create/provision calls. */
    lifecycleTimeoutMs?: number;
}

export interface SandboxAgentSpec {
    agentId: string;
    uid: number;
}

export interface SandboxInfoDto {
    id: string;
    status: "pending" | "running" | "stopped";
    containerName: string;
    containerId?: string;
    volume: string;
    image: string;
    network: string;
    createdAt: string;
    agents: SandboxAgentSpec[];
    resources: {
        memory: string;
        cpus: string;
        pidsLimit: number;
        tmpfsSize: string;
    };
}

export interface ExecuteResultDto {
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    executionTimeMs: number;
    timedOut: boolean;
    killed: boolean;
    command: string;
    args?: string[];
}

export interface WriteFileResultDto {
    success: boolean;
    path: string;
    bytesWritten: number;
    error?: string;
}

export interface ReadFileResultDto {
    success: boolean;
    path: string;
    /** base64 — the endpoint is binary-safe. */
    content: string;
    bytesRead: number;
    error?: string;
}

export class SandboxServiceError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(message: string, status: number, code: string) {
        super(message);
        this.name = "SandboxServiceError";
        this.status = status;
        this.code = code;
    }

    /** The agent has no directory in this sandbox yet. Provision it and retry. */
    get isAgentNotProvisioned(): boolean {
        return this.code === "AGENT_NOT_PROVISIONED";
    }

    /** The host is at capacity. Worth retrying after a short wait. */
    get isBusy(): boolean {
        return this.code === "SANDBOX_BUSY";
    }
}

/** `fetch`, injectable so tests never open a socket. */
export type FetchLike = (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export class SandboxServiceClient {
    private readonly _url: string;
    private readonly _headers: Record<string, string>;
    private readonly _lifecycleTimeoutMs: number;
    private readonly _fetch: FetchLike;

    constructor(options: SandboxServiceOptions, fetchImpl?: FetchLike) {
        this._url = options.url.replace(/\/$/, "");
        this._headers = {
            "content-type": "application/json",
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        };
        this._lifecycleTimeoutMs = options.lifecycleTimeoutMs ?? 120_000;
        this._fetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    }

    /**
     * Create or adopt the organization's container, optionally provisioning the
     * whole roster in the same call. Idempotent.
     */
    ensureSandbox(input: {
        organizationId: string;
        image?: string;
        network?: string;
        readOnly?: boolean;
        env?: Record<string, string>;
        agents?: SandboxAgentSpec[];
    }): Promise<SandboxInfoDto> {
        return this._request<SandboxInfoDto>("POST", "/sandboxes", input, this._lifecycleTimeoutMs);
    }

    /** Registry lookup. Throws `SANDBOX_NOT_FOUND` when the service has no entry. */
    getSandbox(organizationId: string): Promise<SandboxInfoDto> {
        return this._request<SandboxInfoDto>(
            "GET",
            `/sandboxes/${encodeURIComponent(organizationId)}`,
            undefined,
            this._lifecycleTimeoutMs,
        );
    }

    /** Give one agent its directory. Idempotent, and never recreates the container. */
    ensureAgent(
        organizationId: string,
        agent: SandboxAgentSpec,
    ): Promise<{ success: boolean; agentId: string; uid: number }> {
        return this._request(
            "POST",
            `/sandboxes/${encodeURIComponent(organizationId)}/agents/${encodeURIComponent(agent.agentId)}`,
            { uid: agent.uid },
            this._lifecycleTimeoutMs,
        );
    }

    exec(
        organizationId: string,
        input: {
            agentId: string;
            command: string;
            args?: string[];
            options?: { timeoutMs?: number; env?: Record<string, string>; cwd?: string };
        },
        signal?: AbortSignal,
    ): Promise<ExecuteResultDto> {
        // The service clamps the timeout itself; give the HTTP call a little more
        // than the command so a timed-out command still returns its output
        // instead of surfacing as a transport error.
        const budget = (input.options?.timeoutMs ?? this._lifecycleTimeoutMs) + 5_000;
        return this._request<ExecuteResultDto>(
            "POST",
            `/sandboxes/${encodeURIComponent(organizationId)}/exec`,
            input,
            budget,
            signal,
        );
    }

    writeFile(
        organizationId: string,
        input: {
            agentId: string;
            path: string;
            content: string;
            encoding?: "utf-8" | "base64";
        },
    ): Promise<WriteFileResultDto> {
        return this._request<WriteFileResultDto>(
            "POST",
            `/sandboxes/${encodeURIComponent(organizationId)}/write-file`,
            input,
            this._lifecycleTimeoutMs,
        );
    }

    readFile(
        organizationId: string,
        input: { agentId: string; path: string },
    ): Promise<ReadFileResultDto> {
        return this._request<ReadFileResultDto>(
            "POST",
            `/sandboxes/${encodeURIComponent(organizationId)}/read-file`,
            input,
            this._lifecycleTimeoutMs,
        );
    }

    /**
     * Remove the organization's container. The volume — every agent's work —
     * survives unless `purgeVolume` is set, which is a tenant-deletion action,
     * not a cleanup one.
     */
    destroySandbox(
        organizationId: string,
        options: { purgeVolume?: boolean } = {},
    ): Promise<{ success: boolean; purgedVolume: boolean }> {
        const query = options.purgeVolume ? "?purgeVolume=1" : "";
        return this._request(
            "DELETE",
            `/sandboxes/${encodeURIComponent(organizationId)}${query}`,
            undefined,
            this._lifecycleTimeoutMs,
        );
    }

    private async _request<T>(
        method: string,
        path: string,
        body: unknown,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<T> {
        const response = await this._fetch(`${this._url}${path}`, {
            method,
            headers: this._headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: signal ?? AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
            const raw = await response.text();
            let message = raw;
            let code = "UNKNOWN";
            try {
                const parsed = JSON.parse(raw) as { error?: string; code?: string };
                message = parsed.error ?? raw;
                code = parsed.code ?? code;
            } catch {
                // Not JSON — a proxy error page or an empty body. Keep the text.
            }
            throw new SandboxServiceError(
                `sandbox-service ${method} ${path} failed (${response.status}): ${message}`,
                response.status,
                code,
            );
        }

        return (await response.json()) as T;
    }
}
