/**
 * Directory listings, in one command per request.
 *
 * Skill discovery is read-heavy and shallow: for every configured skills root it
 * lists the skill directories, stats each one to see whether anything changed,
 * then reads the `SKILL.md` bodies. Answering each of those over its own
 * `docker exec` costs ~50ms a call and there are dozens per turn, so the whole
 * subtree is fetched once and served from that snapshot.
 *
 * Pure: builds the probe and parses its output. Running it belongs to
 * `SandboxContainer`, which runs it as the requesting agent's uid — so the
 * kernel, not this file, is what stops one agent listing another's directory.
 */

/** One file or directory, as the container sees it. */
export interface TreeEntry {
    /** Absolute path inside the container. */
    path: string;
    type: "file" | "directory";
    /** Bytes. Meaningless for directories, which report their own block size. */
    size: number;
    /**
     * Unix seconds. `stat -c %Y` is second-granular, which is finer than any
     * staleness check here needs.
     */
    modifiedAt: number;
    /** Present and true only for a symlink, which is never followed. */
    isSymlink?: boolean;
}

export interface ListTreeResult {
    entries: TreeEntry[];
    /**
     * True when the subtree hit `TREE_MAX_ENTRIES`. The caller sees a partial
     * listing rather than a failure, and knows not to trust its completeness.
     */
    truncated: boolean;
}

/**
 * How deep a listing may go. A skill is `<name>/SKILL.md` plus `references/`,
 * `scripts/` and `assets/` beside it, so four levels covers the spec with room
 * for one nested reference directory.
 */
export const TREE_MAX_DEPTH = 8;

/**
 * Ceiling on entries in one response. An agent owns its directory and can create
 * as many files as its disk quota allows; without a cap it could make a listing
 * large enough to matter to the gateway that has to hold it in memory.
 */
export const TREE_MAX_ENTRIES = 5_000;

/**
 * A shell script listing every entry under each root, one line each.
 *
 * `stat -c` rather than `find -printf`: busybox `find` has no `-printf`, and the
 * sandbox image is Alpine. Symlinks are deliberately not followed — `find -L`
 * would both invite a symlink loop and let a link out of the workspace show up
 * in the listing.
 *
 * Exits 0 whatever it finds. A skills root that does not exist yet is the normal
 * case for a new agent, not an error.
 */
export function buildTreeProbe(roots: string[], maxDepth: number): string {
    const depth = Math.min(Math.max(1, Math.trunc(maxDepth) || 1), TREE_MAX_DEPTH);
    const quoted = roots.map(shellQuote).join(" ");
    return (
        `for root in ${quoted}; do ` +
        `[ -d "$root" ] || continue; ` +
        `find "$root" -maxdepth ${depth} -exec stat -c '%F|%s|%Y|%n' {} + 2>/dev/null; ` +
        `done; exit 0`
    );
}

/**
 * Parse the probe's output.
 *
 * Fields are split on the first three delimiters, so a `|` in a filename cannot
 * shift the numbers. A newline in a filename would still split one entry into
 * two unparseable lines; both halves are dropped rather than guessed at.
 */
export function parseTreeOutput(stdout: string, limit: number = TREE_MAX_ENTRIES): ListTreeResult {
    const entries: TreeEntry[] = [];
    let truncated = false;

    for (const line of stdout.split("\n")) {
        if (!line) continue;
        if (entries.length >= limit) {
            truncated = true;
            break;
        }
        const entry = parseTreeLine(line);
        if (entry) entries.push(entry);
    }

    return { entries, truncated };
}

function parseTreeLine(line: string): TreeEntry | null {
    const first = line.indexOf("|");
    const second = line.indexOf("|", first + 1);
    const third = line.indexOf("|", second + 1);
    if (first < 1 || second < 0 || third < 0) return null;

    const kind = line.slice(0, first);
    const size = Number(line.slice(first + 1, second));
    const modifiedAt = Number(line.slice(second + 1, third));
    const path = line.slice(third + 1);
    if (!path.startsWith("/") || !Number.isFinite(size) || !Number.isFinite(modifiedAt)) {
        return null;
    }

    // `stat -c %F` spells the type out: "directory", "regular file", "regular
    // empty file", "symbolic link", and a handful of device types.
    if (kind === "directory") {
        return { path, type: "directory", size, modifiedAt };
    }
    if (kind === "symbolic link") {
        return { path, type: "file", size, modifiedAt, isSymlink: true };
    }
    return { path, type: "file", size, modifiedAt };
}

/** Single-quote for `sh`, so a path is one word whatever it contains. */
function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}
