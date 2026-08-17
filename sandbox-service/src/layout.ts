/**
 * Workspace layout inside an organization's container, and the pure rules that
 * guard it. No Docker, no I/O — everything here is unit-testable.
 *
 * ```
 * /workspace                     root-owned, 0755
 *   .shared/                     root-owned, 0755 — readable by every agent,
 *                                writable by none (org-wide material lives here)
 *   <agentId>/                   uid-owned,  0700 — one agent's own directory
 *     .tmp/                      uid-owned,  0700 — that agent's TMPDIR
 * ```
 *
 * The volume holding `/workspace` is the source of truth: it outlives the
 * container, the service process, and the host's page cache. Nothing here is
 * mirrored to object storage, so the layout on disk *is* the state.
 *
 * Mirrored on the gateway side by apps/gateway/src/sandbox/layout.ts — the two
 * are separate deployables, so the constants are duplicated deliberately rather
 * than shared through a package neither of them should depend on.
 */

import { posix } from "node:path";

/** Mount point of the organization's volume inside the container. */
export const WORKSPACE_ROOT = "/workspace";

/** Org-wide, agent-readable, agent-unwritable directory. */
export const SHARED_DIR = `${WORKSPACE_ROOT}/.shared`;

/** Per-agent TMPDIR, inside the agent's own directory so it inherits 0700. */
export const AGENT_TMP_DIRNAME = ".tmp";

/**
 * uid pool baked into the sandbox image at build time (`agent0…agent63`).
 *
 * The pool has to be baked because the container's root filesystem is
 * read-only, so `adduser` cannot run later. Growing it means rebuilding the
 * image with new build args AND raising these bounds — a uid with no matching
 * OS user makes every `docker exec -u` fail, so the service refuses one up
 * front rather than handing back a confusing exec error.
 */
export const UID_BASE = Number(process.env.SANDBOX_UID_BASE) || 10_000;
export const UID_POOL_SIZE = Number(process.env.SANDBOX_UID_POOL_SIZE) || 64;

/**
 * Agent ids are interpolated into container names and volume paths, and are
 * passed to a provisioning shell, so they are restricted to a conservative
 * token rather than trusted. Uuids pass; anything with a slash, space, quote,
 * dollar or leading dot does not.
 */
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Same rule for organization ids, which name the container and the volume. */
const ORG_ID_PATTERN = AGENT_ID_PATTERN;

export function isValidAgentId(value: string): boolean {
    return AGENT_ID_PATTERN.test(value);
}

export function isValidOrganizationId(value: string): boolean {
    return ORG_ID_PATTERN.test(value);
}

export function isValidUid(value: number): boolean {
    return (
        Number.isInteger(value) &&
        value >= UID_BASE &&
        value < UID_BASE + UID_POOL_SIZE
    );
}

/** The agent's own directory inside the shared organization container. */
export function agentWorkdir(agentId: string): string {
    return `${WORKSPACE_ROOT}/${agentId}`;
}

/** That agent's TMPDIR. */
export function agentTmpDir(agentId: string): string {
    return `${agentWorkdir(agentId)}/${AGENT_TMP_DIRNAME}`;
}

/** Docker object names derived from the organization id. */
export function containerName(organizationId: string): string {
    return `hyros-sandbox-${organizationId}`;
}

export function volumeName(organizationId: string): string {
    return `hyros-workspace-${organizationId}`;
}

/**
 * Each organization gets its own Docker network, so agents have egress but
 * cannot reach another tenant's container over IP. Containers on separate
 * user-defined bridges are isolated from each other by Docker's own rules.
 */
export function networkName(organizationId: string): string {
    return `hyros-net-${organizationId}`;
}

export type PathAccess = "read" | "write";

/**
 * Resolves `filePath` for one agent and returns null if the result is outside
 * what that agent may touch.
 *
 * Relative paths resolve against the agent's own directory. Resolution happens
 * before the check, so `..` traversal and a sibling's directory are both caught
 * — a prefix test on the raw string lets `/workspace/a/../b` through.
 *
 * Reads may also land in `.shared`; writes never may. The kernel enforces this
 * too (the directory is root-owned and the agent execs as its own uid), so this
 * is the layer that returns a clear error instead of a bare EACCES.
 */
export function resolveAgentPath(
    agentId: string,
    filePath: string,
    access: PathAccess,
): string | null {
    const workdir = agentWorkdir(agentId);
    const resolved = posix.resolve(workdir, filePath);

    if (resolved === workdir || resolved.startsWith(`${workdir}/`)) {
        return resolved;
    }
    if (
        access === "read" &&
        (resolved === SHARED_DIR || resolved.startsWith(`${SHARED_DIR}/`))
    ) {
        return resolved;
    }
    return null;
}
