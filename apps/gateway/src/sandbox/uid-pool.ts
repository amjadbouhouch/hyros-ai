/**
 * Assigning an agent its OS uid inside the organization's container.
 *
 * Pure functions: the caller owns persistence (an agent's uid has to be stable
 * for the life of the agent, so it belongs in a column, not in memory). Nothing
 * here talks to a database or to Docker.
 *
 * Two rules the pool exists to enforce:
 *
 *   - **In range.** The uids come from a pool baked into the sandbox image at
 *     build time (`agent0…agent63`). A uid outside it has no OS user, and every
 *     `docker exec -u` for that agent fails.
 *   - **Never reused.** A departed agent keeps its uid. Handing it to a new agent
 *     would make the old agent's leftovers readable by whoever comes next, which
 *     is exactly the boundary the uid exists to draw.
 *
 * Mirrored by SANDBOX_UID_BASE / SANDBOX_UID_POOL_SIZE in the service and by the
 * build args in Dockerfile.sandbox. Growing the pool means rebuilding the image
 * and raising all three.
 */

export const UID_BASE = 10_000;
export const UID_POOL_SIZE = 64;

export class SandboxUidPoolExhaustedError extends Error {
    readonly code = "UID_POOL_EXHAUSTED";

    constructor(readonly organizationId: string) {
        super(
            `Organization ${organizationId} has used all ${UID_POOL_SIZE} sandbox uids. ` +
                `Raise SANDBOX_UID_POOL_SIZE and rebuild the sandbox image.`,
        );
        this.name = "SandboxUidPoolExhaustedError";
    }
}

export function isUidInPool(uid: number): boolean {
    return Number.isInteger(uid) && uid >= UID_BASE && uid < UID_BASE + UID_POOL_SIZE;
}

/**
 * The lowest uid in the pool that this organization has never handed out.
 *
 * `taken` must include agents that were archived or deleted — their uids are
 * spent, not free. Pass every uid the organization has ever assigned.
 */
export function allocateSandboxUid(
    organizationId: string,
    taken: Iterable<number>,
): number {
    const used = new Set(taken);
    for (let uid = UID_BASE; uid < UID_BASE + UID_POOL_SIZE; uid += 1) {
        if (!used.has(uid)) return uid;
    }
    throw new SandboxUidPoolExhaustedError(organizationId);
}
