/**
 * The registry of live organization containers, plus the reaper.
 *
 * Two things follow from the volume being the source of truth, and both are
 * departures from a sync-backed design:
 *
 *   - **Reaping is cheap.** Destroying a container discards a cache, not work,
 *     so the TTL is a backstop against abandoned tenants rather than a deadline
 *     anyone races.
 *   - **A service restart must not tear anything down.** Containers outlive this
 *     process; on boot we adopt them, and on shutdown we leave them running. An
 *     agent mid-task survives a gateway deploy.
 */

import { listExistingOrganizations, SandboxContainer, type SandboxContainerOptions } from "./container.js";

/**
 * Idle window before an organization's container is reclaimed. Hours, not
 * minutes: these containers are meant to stay warm, and the reaper exists for
 * tenants that stopped showing up, not for ordinary gaps between turns.
 */
const TTL_MS = Number(process.env.SANDBOX_TTL_MS) || 4 * 60 * 60 * 1000;
const REAPER_INTERVAL_MS = Number(process.env.SANDBOX_REAPER_INTERVAL_MS) || 30 * 1000;

interface Entry {
    sandbox: SandboxContainer;
    lastActivity: number;
}

const entries = new Map<string, Entry>();

/**
 * Starts that have begun but not yet reached the map. Two requests for the same
 * organization arrive together on a cold start — both miss `entries`, and
 * without this both would `docker run --name <same>`, the loser failing with a
 * name conflict.
 */
const starting = new Map<string, Promise<{ sandbox: SandboxContainer; created: boolean }>>();

let reaperTimer: ReturnType<typeof setInterval> | null = null;

export function getSandbox(organizationId: string): SandboxContainer | undefined {
    return entries.get(organizationId)?.sandbox;
}

export function touchSandbox(organizationId: string): void {
    const entry = entries.get(organizationId);
    if (entry) entry.lastActivity = Date.now();
}

/**
 * Get the organization's container, starting or adopting it if needed.
 *
 * Every request path goes through here rather than 404-ing on a cold registry:
 * a container is a cache in front of the volume, so rebuilding one is lossless
 * and the client never has to orchestrate a reconnect.
 */
export async function ensureSandbox(
    options: SandboxContainerOptions,
): Promise<{ sandbox: SandboxContainer; created: boolean }> {
    const id = options.organizationId;

    const existing = entries.get(id);
    if (existing) {
        existing.lastActivity = Date.now();
        // Heals a container that died or was reaped out from under us.
        const { created } = await existing.sandbox.start();
        return { sandbox: existing.sandbox, created };
    }

    const inFlight = starting.get(id);
    if (inFlight) {
        const result = await inFlight;
        // `created: false` is the honest answer — this request did not create it.
        return { sandbox: result.sandbox, created: false };
    }

    const promise = (async () => {
        const sandbox = new SandboxContainer(options);
        const { created } = await sandbox.start();
        entries.set(id, { sandbox, lastActivity: Date.now() });
        return { sandbox, created };
    })();

    starting.set(id, promise);
    try {
        return await promise;
    } finally {
        starting.delete(id);
    }
}

export async function destroySandbox(
    organizationId: string,
    options: { purgeVolume?: boolean } = {},
): Promise<boolean> {
    const entry = entries.get(organizationId);
    if (!entry) return false;
    await entry.sandbox.destroy(options);
    entries.delete(organizationId);
    return true;
}

/**
 * Register containers left behind by a previous run of this service.
 *
 * They are registered, not started: adopting means the reaper can reclaim them
 * and the next request reuses them. Without this an orphan holds a tenant's CPU
 * and memory reservation with nothing left that knows about it.
 */
export async function adoptExistingSandboxes(
    defaults: Omit<SandboxContainerOptions, "organizationId"> = {},
): Promise<number> {
    const organizationIds = await listExistingOrganizations();
    let adopted = 0;
    for (const organizationId of organizationIds) {
        if (entries.has(organizationId)) continue;
        entries.set(organizationId, {
            sandbox: new SandboxContainer({ ...defaults, organizationId }),
            lastActivity: Date.now(),
        });
        adopted += 1;
    }
    if (adopted > 0) {
        console.log(`[sandbox] adopted ${adopted} container(s) from a previous run`);
    }
    return adopted;
}

// ─── Reaper ─────────────────────────────────────────────────────────────────

async function reap(): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of entries) {
        const idleMs = now - entry.lastActivity;
        if (idleMs < TTL_MS) continue;
        console.log(
            `[sandbox] reaping ${id} after ${Math.round(idleMs / 1000)}s idle (volume kept)`,
        );
        try {
            // Container only. The volume is the tenant's data; only an explicit
            // purge removes that.
            await entry.sandbox.destroy();
        } catch (error) {
            console.warn(`[sandbox] reap failed for ${id}: ${(error as Error).message}`);
        }
        entries.delete(id);
    }
}

export function startReaper(): void {
    if (reaperTimer) return;
    reaperTimer = setInterval(reap, REAPER_INTERVAL_MS);
    console.log(
        `[sandbox] reaper started — TTL ${TTL_MS / 1000}s, checking every ${
            REAPER_INTERVAL_MS / 1000
        }s`,
    );
}

export function stopReaper(): void {
    if (reaperTimer) {
        clearInterval(reaperTimer);
        reaperTimer = null;
    }
}
