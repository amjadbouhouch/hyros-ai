/**
 * Mastra skill discovery, reading inside the organization's sandbox.
 *
 * `Workspace({ skillSource })` takes any object with five read-only methods —
 * `exists`, `stat`, `readFile`, `readdir`, `realpath` — and uses it *instead of*
 * the workspace filesystem. That is the whole integration: skills can live in the
 * container without the workspace having a filesystem at all.
 *
 * Two skills roots are configured per agent (see `skillRoots`):
 *
 *   /workspace/.shared/skills     the organization's — every agent reads them
 *   /workspace/<agentId>/skills   this agent's own, which it installs itself
 *
 * ## Why a snapshot
 *
 * Discovery is list-and-stat heavy: every configured root is listed, every skill
 * directory stat'd for staleness, and only then are the `SKILL.md` bodies read.
 * Each of those over its own `docker exec` costs tens of milliseconds, and Mastra
 * re-checks staleness before every agent turn. So one `list-tree` call answers
 * `exists`, `stat` and `readdir` for the whole subtree, cached briefly.
 *
 * Two things expire that snapshot. The agent's own writes and commands are known
 * exactly — `HyrosSandbox.mutations` counts them — so the next listing is fresh
 * the moment the agent writes anything. Everything else (an operator adding an
 * org-wide skill) is caught by a short TTL.
 *
 * Note what this does *not* buy: Mastra re-discovers skills at most every 2s
 * (`WorkspaceSkillsImpl.STALENESS_CHECK_COOLDOWN`), so a skill the agent installs
 * lands on its next turn, not the one that wrote it. That gate is Mastra's; a
 * fresher snapshot here cannot open it.
 *
 * ## Why a failure is empty rather than thrown
 *
 * If the sandbox host is unreachable, an agent with no skills is a degraded agent;
 * an agent that cannot start is a broken product. Chat has to survive a sandbox
 * outage — the same reason `HyrosSandbox.start()` does no I/O — so a failed
 * listing logs and serves an empty tree. `readFile` still throws: it is only
 * reached for a file the snapshot said exists, so failing there is a real error
 * worth surfacing to the caller.
 */

import type { SkillSource, SkillSourceEntry, SkillSourceStat } from "@mastra/core/workspace";

import { createLogger } from "../lib/logger.js";
import type { HyrosSandbox } from "./hyros-sandbox.js";
import type { TreeEntryDto } from "./service-client.js";

const log = createLogger("sandbox-skills");

/**
 * How long one listing serves. Mastra's `WorkspaceSkillsImpl` will not re-check
 * staleness more often than every 2s, so a shorter window would only add calls
 * without noticing changes any sooner.
 */
const DEFAULT_TTL_MS = 2_000;

/** Deep enough for `<skill>/references/<file>` with a directory to spare. */
const DEFAULT_MAX_DEPTH = 4;

export interface SandboxSkillSourceOptions {
    /** The agent's handle on its organization's container. */
    sandbox: HyrosSandbox;
    /** Absolute container paths to scan. See `skillRoots`. */
    roots: string[];
    maxDepth?: number;
    ttlMs?: number;
    /** Injectable clock, so tests do not sleep. */
    now?: () => number;
}

interface Snapshot {
    /** Every entry, by absolute path. */
    byPath: Map<string, TreeEntryDto>;
    /** Directory path → its immediate children. */
    children: Map<string, SkillSourceEntry[]>;
}

const EMPTY_SNAPSHOT: Snapshot = { byPath: new Map(), children: new Map() };

export class SandboxSkillSource implements SkillSource {
    private readonly _sandbox: HyrosSandbox;
    private readonly _roots: string[];
    private readonly _maxDepth: number;
    private readonly _ttlMs: number;
    private readonly _now: () => number;

    private _snapshot: Snapshot = EMPTY_SNAPSHOT;
    /**
     * When the snapshot was taken. `-Infinity` means never: 0 would read as the
     * epoch, and against an injected clock starting at 0 that looks fresh — the
     * source would serve an empty tree without ever listing the container.
     */
    private _fetchedAt = Number.NEGATIVE_INFINITY;
    /** The sandbox's mutation count when the snapshot was taken. */
    private _snapshotMutations = -1;
    /** In-flight listing, so a burst of calls in one refresh makes one request. */
    private _inFlight: Promise<Snapshot> | undefined;

    constructor(options: SandboxSkillSourceOptions) {
        this._sandbox = options.sandbox;
        this._roots = options.roots;
        this._maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
        this._ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this._now = options.now ?? Date.now;
    }

    async exists(path: string): Promise<boolean> {
        const snapshot = await this._load();
        return snapshot.byPath.has(normalize(path));
    }

    async stat(path: string): Promise<SkillSourceStat> {
        const target = normalize(path);
        const entry = (await this._load()).byPath.get(target);
        if (!entry) throw notFound("stat", target);

        // Rounded up to the end of its second, which is not a rounding error but
        // the fix for one. Mastra compares this against a millisecond
        // `Date.now()` taken at discovery: `stat -c %Y` only reports whole
        // seconds, so a skill written at 12:00:05.900 would report 12:00:05.000
        // and lose to a discovery at 12:00:05.100 — and since the directory mtime
        // never moves again, that skill would stay invisible. Rounding up costs an
        // occasional redundant re-scan; rounding down loses skills.
        //
        // `stat -c` gives one timestamp, so creation time reports the same value.
        // Only `modifiedAt` is ever read.
        const modifiedAt = new Date(entry.modifiedAt * 1000 + 999);
        return {
            name: basename(target),
            type: entry.type,
            size: entry.type === "directory" ? 0 : entry.size,
            createdAt: modifiedAt,
            modifiedAt,
        };
    }

    async readdir(path: string): Promise<SkillSourceEntry[]> {
        const target = normalize(path);
        const snapshot = await this._load();
        const entries = snapshot.children.get(target);
        if (entries) return entries;
        // A directory that exists but is empty has no children entry; one that
        // does not exist at all is an error, as it is for a real filesystem.
        if (snapshot.byPath.get(target)?.type === "directory") return [];
        throw notFound("readdir", target);
    }

    /**
     * Read a skill file. Bypasses the snapshot: contents are needed once per skill
     * per refresh, and caching them would only hold `SKILL.md` bodies twice.
     */
    async readFile(path: string): Promise<string | Buffer> {
        const target = normalize(path);
        const result = await this._sandbox.readFile(target);
        if (!result.success) {
            throw new Error(`Failed to read ${target} in the sandbox: ${result.error ?? "unknown"}`);
        }
        return Buffer.from(result.content, "base64");
    }

    /** Nothing here aliases: symlinks are never followed, so paths are canonical. */
    async realpath(path: string): Promise<string> {
        return normalize(path);
    }

    /** Drop the cached listing, so the next call re-reads the container. */
    invalidate(): void {
        this._fetchedAt = Number.NEGATIVE_INFINITY;
        this._snapshotMutations = -1;
        this._snapshot = EMPTY_SNAPSHOT;
    }

    private _load(): Promise<Snapshot> {
        const mutations = this._sandbox.mutations;
        // The TTL is for changes made outside this agent — an operator adding an
        // org-wide skill. Changes made *by* this agent are known exactly, so a
        // command or a write invalidates the snapshot at once: an agent that
        // installs a skill can use it in the same turn.
        const fresh =
            mutations === this._snapshotMutations && this._now() - this._fetchedAt < this._ttlMs;
        if (fresh) return Promise.resolve(this._snapshot);
        if (this._inFlight) return this._inFlight;

        this._inFlight = this._fetch()
            .then((snapshot) => {
                this._snapshot = snapshot;
                this._fetchedAt = this._now();
                this._snapshotMutations = mutations;
                return snapshot;
            })
            .finally(() => {
                this._inFlight = undefined;
            });
        return this._inFlight;
    }

    private async _fetch(): Promise<Snapshot> {
        try {
            const result = await this._sandbox.listTree(this._roots, this._maxDepth);
            if (result.truncated) {
                // Say so rather than let a partial listing read as the whole tree.
                log.warn("[SKILLS] listing truncated; some skills may be missing", {
                    agentId: this._sandbox.agentId,
                    entries: result.entries.length,
                });
            }
            return index(result.entries);
        } catch (error) {
            log.warn("[SKILLS] could not list skills in the sandbox", {
                agentId: this._sandbox.agentId,
                organizationId: this._sandbox.organizationId,
                error: error instanceof Error ? error.message : String(error),
            });
            return EMPTY_SNAPSHOT;
        }
    }
}

/** Build the path and children indexes from a flat listing. */
function index(entries: TreeEntryDto[]): Snapshot {
    const byPath = new Map<string, TreeEntryDto>();
    const children = new Map<string, SkillSourceEntry[]>();

    for (const entry of entries) {
        byPath.set(normalize(entry.path), entry);
    }

    for (const entry of entries) {
        const path = normalize(entry.path);
        const parent = dirname(path);
        // Only index children of directories inside the listing: the parent of a
        // root is outside it, and claiming to list it would be a lie.
        if (!byPath.has(parent) || parent === path) continue;
        const siblings = children.get(parent) ?? [];
        siblings.push({
            name: basename(path),
            type: entry.type,
            ...(entry.isSymlink ? { isSymlink: true } : {}),
        });
        children.set(parent, siblings);
    }

    return { byPath, children };
}

/** Collapse `//`, `.` and a trailing slash. Paths here are always absolute. */
function normalize(path: string): string {
    const segments: string[] = [];
    for (const segment of path.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") segments.pop();
        else segments.push(segment);
    }
    return `/${segments.join("/")}`;
}

function basename(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
    const cut = path.lastIndexOf("/");
    return cut <= 0 ? "/" : path.slice(0, cut);
}

/** Shaped like a filesystem error, since that is what the caller expects. */
function notFound(operation: string, path: string): Error {
    const error = new Error(`ENOENT: no such file or directory, ${operation} '${path}'`) as Error & {
        code?: string;
    };
    error.code = "ENOENT";
    return error;
}
