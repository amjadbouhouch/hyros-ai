/**
 * The workspace layout an agent sees inside its organization's sandbox, plus the
 * one tool-layer guardrail the gateway adds on top of the kernel's.
 *
 * ```
 * /workspace
 *   .shared/       org-wide, readable by every agent, writable by none
 *   <agentId>/     this agent's own directory (uid-owned, 0700)
 *     .tmp/        this agent's TMPDIR
 * ```
 *
 * Mirrored by sandbox-service/src/layout.ts, which enforces the same rules
 * server-side. The two are separate deployables, so the constants are duplicated
 * deliberately rather than shared through a package neither should depend on —
 * change one, change the other.
 */

/** Mount point of the organization's volume inside the container. */
export const WORKSPACE_ROOT = "/workspace";

/** Org-wide, agent-readable, agent-unwritable directory. */
export const SHARED_DIR = `${WORKSPACE_ROOT}/.shared`;

/** The agent's own directory inside the shared organization container. */
export function agentWorkdir(agentId: string): string {
    return `${WORKSPACE_ROOT}/${agentId}`;
}

/**
 * Resolve any path the agent might name to its absolute form inside the
 * container.
 *
 * Accepts every shape a model reaches for:
 * - `notes.md`            → `/workspace/<agentId>/notes.md`
 * - `./notes.md`          → `/workspace/<agentId>/notes.md`
 * - `/notes.md`           → `/workspace/<agentId>/notes.md`
 * - `/workspace/<id>/x`   → unchanged
 */
export function resolveWorkspacePath(agentId: string, filePath: string): string {
    const normalized = filePath.replace(/^\.?\//, "");
    return normalized.startsWith("workspace/")
        ? `/${normalized}`
        : `${agentWorkdir(agentId)}/${normalized}`;
}

/**
 * Every `/workspace/...` path a command line mentions, however it is attached —
 * bare, after a redirect, or as `of=<path>`.
 */
const WORKSPACE_PATH_PATTERN = /\/workspace\/[^\s'"`;|&>()]*/g;

/**
 * Returns a refusal message when a command names a path belonging to another
 * agent, or null when every path it mentions is the caller's own.
 *
 * The kernel is the real boundary: each agent execs as its own uid against a
 * `0700` directory, and a cross-agent read fails with EACCES. This is the
 * tool-layer backstop that turns that into an explanation the model can act on,
 * and it covers the case where the filesystem cannot enforce ownership at all
 * (a host bind mount on Docker Desktop reports fabricated ownership).
 *
 * Deliberately narrow. Only paths under `/workspace/` are inspected, so `/tmp`,
 * `/usr/bin/python3` and every other absolute path a skill relies on pass
 * through untouched. Reads of the shared directory are allowed — it is org-wide
 * by design.
 */
export function assertOwnWorkspacePaths(command: string, agentId: string): string | null {
    const workdir = agentWorkdir(agentId);

    for (const match of command.match(WORKSPACE_PATH_PATTERN) ?? []) {
        // Resolve first: `/workspace/self/../sibling` names a sibling.
        const resolved = normalizePosix(match);
        if (resolved === workdir || resolved.startsWith(`${workdir}/`)) continue;
        if (resolved === SHARED_DIR || resolved.startsWith(`${SHARED_DIR}/`)) continue;
        return (
            `That path belongs to another agent's workspace. ` +
            `You can only work inside ${workdir}, and read from ${SHARED_DIR}.`
        );
    }

    return null;
}

/** `..` and `.` collapsing for an absolute posix path, without touching the fs. */
function normalizePosix(path: string): string {
    const segments: string[] = [];
    for (const segment of path.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") segments.pop();
        else segments.push(segment);
    }
    return `/${segments.join("/")}`;
}
