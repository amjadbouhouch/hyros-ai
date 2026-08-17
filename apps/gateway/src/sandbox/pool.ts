/**
 * Owns sandbox handles so Mastra never does.
 *
 * One handle per (organization, agent), memoized so follow-up turns reuse it.
 * There is deliberately no container-state tracking here: the sandbox-service
 * starts or adopts the organization's container on every route it serves and
 * recovers the agent roster from the volume, so the only thing worth caching on
 * this side is the handle itself. A handle ensures its container once, on its
 * first command, through Mastra's own lazy `ensureRunning()`.
 *
 * Why a pool rather than a static sandbox on the workspace: `workspace.destroy()`
 * destroys a *static* sandbox, which for a container shared by an organization
 * would end every sibling agent's session. Mastra documents that it does not
 * touch a resolver-returned sandbox — the caller owns it — so ownership lives
 * here, and `HyrosSandbox.destroy()` is a no-op.
 *
 * Not wired to anything yet. When it is, `resolveSandbox` is the resolver body
 * and `sandboxCacheKey` is the key function Mastra memoizes by.
 */

import { HyrosSandbox } from "./hyros-sandbox.js";
import { SandboxServiceClient, type SandboxServiceOptions } from "./service-client.js";

export interface SandboxIdentity {
    organizationId: string;
    agentId: string;
    /** The agent's uid from the pool — stable for the life of the agent. */
    uid: number;
}

export interface SandboxPoolOptions {
    service: SandboxServiceOptions;
    /** Overrides the image containers are created with. */
    image?: string;
    /** Per-command default when a caller sends no timeout. */
    defaultTimeoutMs?: number;
}

/**
 * Mastra's cache key for a resolver-backed sandbox.
 *
 * Per agent, not per organization: two agents in one container are two handles
 * with two working directories, and background-process continuity (once the
 * service grows it) has to reach the handle that started the process.
 */
export function sandboxCacheKey(
    identity: Pick<SandboxIdentity, "organizationId" | "agentId">,
): string {
    return `${identity.organizationId}:${identity.agentId}`;
}

export class SandboxPool {
    private readonly _client: SandboxServiceClient;
    private readonly _options: SandboxPoolOptions;
    private readonly _handles = new Map<string, HyrosSandbox>();

    constructor(options: SandboxPoolOptions, client?: SandboxServiceClient) {
        this._options = options;
        this._client = client ?? new SandboxServiceClient(options.service);
    }

    /** The handle for one agent. Safe to call on every request. */
    resolveSandbox(identity: SandboxIdentity): HyrosSandbox {
        const key = sandboxCacheKey(identity);

        const cached = this._handles.get(key);
        if (cached) return cached;

        const handle = new HyrosSandbox({
            organizationId: identity.organizationId,
            agentId: identity.agentId,
            uid: identity.uid,
            client: this._client,
            ...(this._options.image ? { image: this._options.image } : {}),
            ...(this._options.defaultTimeoutMs
                ? { defaultTimeoutMs: this._options.defaultTimeoutMs }
                : {}),
        });
        this._handles.set(key, handle);
        return handle;
    }

    /**
     * Drop a handle. The container is untouched — an agent going away does not
     * end its organization's session, and the service's reaper handles idle
     * containers.
     */
    forgetAgent(identity: Pick<SandboxIdentity, "organizationId" | "agentId">): void {
        this._handles.delete(sandboxCacheKey(identity));
    }

    /** Drop every handle for an organization. */
    forgetOrganization(organizationId: string): void {
        for (const key of this._handles.keys()) {
            if (key.startsWith(`${organizationId}:`)) this._handles.delete(key);
        }
    }

    /**
     * Remove an organization's container. Its volume — every agent's work —
     * survives unless `purgeVolume` is set, which is tenant deletion, not
     * cleanup.
     */
    async destroyOrganization(
        organizationId: string,
        options: { purgeVolume?: boolean } = {},
    ): Promise<void> {
        this.forgetOrganization(organizationId);
        await this._client.destroySandbox(organizationId, options);
    }
}

/**
 * A pool from the environment, or null when the sandbox service is not
 * configured — which is every environment until this is wired up.
 */
export function createSandboxPoolFromEnv(): SandboxPool | null {
    const url = process.env.SANDBOX_SERVICE_URL;
    if (!url) return null;
    return new SandboxPool({
        service: {
            url,
            ...(process.env.SANDBOX_SERVICE_TOKEN
                ? { token: process.env.SANDBOX_SERVICE_TOKEN }
                : {}),
        },
        ...(process.env.SANDBOX_IMAGE ? { image: process.env.SANDBOX_IMAGE } : {}),
    });
}
