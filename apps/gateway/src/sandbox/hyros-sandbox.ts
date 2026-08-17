/**
 * A Mastra sandbox provider backed by @hyros-ai/sandbox-service.
 *
 * One instance is a **handle for one agent** inside its organization's shared
 * container. The container is identified by the organization id; the handle adds
 * the agent identity that picks the uid, the working directory, and the jail
 * every path is checked against.
 *
 *     new HyrosSandbox({ organizationId, agentId, uid, client })
 *
 * ## Passed to Mastra as a static instance, on purpose
 *
 * `chat/runtime.ts` puts this on the workspace directly rather than behind a
 * resolver, because Mastra inspects a static sandbox to decide which tools the
 * model gets:
 *
 * ```js
 * if (workspace.sandbox) {                       // static — what we do
 *     const baseTool = workspace.sandbox.processes
 *         ? executeCommandWithBackgroundTool : executeCommandTool;
 * } else if (hasSandboxConfig(workspace)) {      // resolver
 *     addTool(EXECUTE_COMMAND, executeCommandWithBackgroundTool);
 *     addTool(GET_PROCESS_OUTPUT); addTool(KILL_PROCESS);
 * }
 * ```
 *
 * This provider has no process manager, so static gets the model exactly one
 * foreground `execute_command`. A resolver would hand it a `background` flag and
 * two process tools with nothing behind them — three ways to reach
 * `SandboxFeatureNotSupportedError`.
 *
 * Two things make a static instance safe here:
 *
 * 1. **`destroy()` is a no-op.** `workspace.destroy()` calls through to a static
 *    sandbox, and this container belongs to the whole organization.
 * 2. **`start()` does no I/O.** The container and this agent's directory are
 *    ensured lazily, on the first command. So building an agent runtime never
 *    touches the sandbox host, and a chat still works when that host is down —
 *    only sandbox commands fail, as tool errors.
 *
 * It also implements no `mount()`: the organization's volume is attached when the
 * container is created, so there is nothing for Mastra's mount machinery to do.
 */

import { MastraSandbox } from "@mastra/core/workspace";
import type {
    CommandResult,
    ExecuteCommandOptions,
    MastraSandboxOptions,
    ProviderStatus,
    SandboxInfo,
} from "@mastra/core/workspace";

import { agentWorkdir, assertOwnWorkspacePaths, resolveWorkspacePath, SHARED_DIR } from "./layout.js";
import {
    SandboxServiceError,
    type ListTreeResultDto,
    type ReadFileResultDto,
    type SandboxServiceClient,
    type WriteFileResultDto,
} from "./service-client.js";

export interface HyrosSandboxOptions extends MastraSandboxOptions {
    /** The tenant — names the shared container on the sandbox host. */
    organizationId: string;
    /** Which agent this handle acts as. */
    agentId: string;
    /** That agent's OS uid, from the pool (see uid-pool.ts). */
    uid: number;
    client: SandboxServiceClient;
    /** Per-command default when the caller sends no timeout. */
    defaultTimeoutMs?: number;
    /** Overrides the image the container is created with. */
    image?: string;
}

export class HyrosSandbox extends MastraSandbox {
    readonly id: string;
    readonly name = "HyrosSandbox";
    readonly provider = "hyros-sandbox-service";
    status: ProviderStatus = "pending";

    readonly organizationId: string;
    readonly agentId: string;
    readonly uid: number;

    private readonly _client: SandboxServiceClient;
    private readonly _defaultTimeoutMs: number;
    private readonly _image: string | undefined;
    private readonly _createdAt = new Date();
    /** First-use provisioning, memoized. See `_ensureProvisioned`. */
    private _provisioned: Promise<void> | undefined;
    private _mutations = 0;

    constructor(options: HyrosSandboxOptions) {
        super({
            name: "HyrosSandbox",
            onStart: options.onStart,
            onStop: options.onStop,
            onDestroy: options.onDestroy,
        });

        // The container is per organization; this handle is per agent, so the
        // Mastra-level id has to name both or two agents would look like one.
        this.id = `${options.organizationId}:${options.agentId}`;
        this.organizationId = options.organizationId;
        this.agentId = options.agentId;
        this.uid = options.uid;
        this._client = options.client;
        this._defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
        this._image = options.image;
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * No I/O. Mastra calls this when the workspace initializes — i.e. whenever an
     * agent runtime is built, which happens on every first chat request. Reaching
     * the sandbox host there would make an unrelated outage break chat, so the
     * container is ensured on first use instead (`_ensureProvisioned`).
     */
    async start(): Promise<void> {}

    /** Local only. The container is shared, so one agent never stops it. */
    async stop(): Promise<void> {
        this.status = "stopped";
    }

    /**
     * Deliberately does not touch the container.
     *
     * The container belongs to the organization, not to this agent, and the
     * service keys it by organization id — so calling through to
     * `DELETE /sandboxes/:id` here would destroy every sibling agent's
     * environment mid-task. Container lifetime belongs to the pool; the reaper
     * reclaims idle ones, and the volume keeps the work either way.
     */
    async destroy(): Promise<void> {
        this.status = "stopped";
    }

    /**
     * How many operations have run that could have changed this agent's files.
     *
     * Anything caching a view of the workspace needs to know when that view went
     * stale, and a command or a write is exactly when. `SandboxSkillSource` reads
     * this so an agent that installs a skill can use it in the same turn, instead
     * of waiting for a cache to expire.
     *
     * Counts every command, not only ones that look like writes: a command line is
     * a shell script, and guessing which ones write is a guess.
     */
    get mutations(): number {
        return this._mutations;
    }

    // ─── Commands ────────────────────────────────────────────────────────────

    async executeCommand(
        command: string,
        args?: string[],
        options?: ExecuteCommandOptions,
    ): Promise<CommandResult> {
        await this.ensureRunning();
        // Before the call, and whatever its outcome: a command that fails may have
        // written something first.
        this._mutations += 1;

        const commandLine = args?.length ? `${command} ${args.join(" ")}` : command;
        const refusal = assertOwnWorkspacePaths(commandLine, this.agentId);
        if (refusal) {
            // A refusal the model can act on beats an EACCES it has to guess at.
            return {
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: `Command blocked: ${refusal}`,
                executionTimeMs: 0,
            };
        }

        const timeoutMs = options?.timeout ?? this._defaultTimeoutMs;
        const request = {
            agentId: this.agentId,
            command,
            ...(args ? { args } : {}),
            options: {
                timeoutMs,
                ...(options?.env ? { env: toStringRecord(options.env) } : {}),
                ...(options?.cwd ? { cwd: options.cwd } : {}),
            },
        };

        const result = await this._withAgentProvisioned(() =>
            this._client.exec(this.organizationId, request, options?.abortSignal),
        );

        return {
            success: result.success,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            executionTimeMs: result.executionTimeMs,
            timedOut: result.timedOut,
            killed: result.killed,
            command: result.command,
            args: result.args,
        };
    }

    // ─── Files ───────────────────────────────────────────────────────────────

    /**
     * Absolute container path for anything the agent might name. Relative paths
     * land in the agent's own directory.
     */
    resolvePath(filePath: string): string {
        return resolveWorkspacePath(this.agentId, filePath);
    }

    /** Write a file as this agent. `base64` for binaries. */
    async writeFile(
        filePath: string,
        content: string,
        encoding: "utf-8" | "base64" = "utf-8",
    ): Promise<WriteFileResultDto> {
        await this.ensureRunning();
        this._mutations += 1;
        return this._withAgentProvisioned(() =>
            this._client.writeFile(this.organizationId, {
                agentId: this.agentId,
                path: this.resolvePath(filePath),
                content,
                encoding,
            }),
        );
    }

    /** Read a file as this agent. Content comes back base64. */
    async readFile(filePath: string): Promise<ReadFileResultDto> {
        await this.ensureRunning();
        return this._withAgentProvisioned(() =>
            this._client.readFile(this.organizationId, {
                agentId: this.agentId,
                path: this.resolvePath(filePath),
            }),
        );
    }

    /**
     * List everything under each root, in one call.
     *
     * Roots are absolute container paths, and the service checks each against what
     * this agent may read — so `.shared` is listable and a sibling's directory is
     * not. Used by `SandboxSkillSource`; see it for why one call matters.
     */
    async listTree(roots: string[], maxDepth?: number): Promise<ListTreeResultDto> {
        await this.ensureRunning();
        return this._withAgentProvisioned(() =>
            this._client.listTree(this.organizationId, {
                agentId: this.agentId,
                roots,
                ...(maxDepth === undefined ? {} : { maxDepth }),
            }),
        );
    }

    // ─── Description ─────────────────────────────────────────────────────────

    getInstructions(): string {
        return [
            `You have a Linux sandbox. Shell commands run inside it as your own user.`,
            `Your working directory is ${agentWorkdir(this.agentId)} — relative paths resolve there,`,
            `and it is the only place you can write.`,
            `${SHARED_DIR} holds material shared across this organization's agents: readable, not writable.`,
            `Other agents have their own directories alongside yours and are off limits.`,
            `/tmp is writable but wiped when the sandbox restarts; anything you want to keep goes in your own directory.`,
        ].join(" ");
    }

    async getInfo(): Promise<SandboxInfo> {
        try {
            const info = await this._client.getSandbox(this.organizationId);
            return {
                id: this.id,
                name: this.name,
                provider: this.provider,
                status: this.status,
                createdAt: new Date(info.createdAt),
                metadata: {
                    organizationId: this.organizationId,
                    agentId: this.agentId,
                    uid: this.uid,
                    workdir: agentWorkdir(this.agentId),
                    container: info.containerName,
                    volume: info.volume,
                    image: info.image,
                    agentsInContainer: info.agents.length,
                },
            };
        } catch {
            // The service may simply not have this container registered yet.
            return {
                id: this.id,
                name: this.name,
                provider: this.provider,
                status: this.status,
                createdAt: this._createdAt,
                metadata: {
                    organizationId: this.organizationId,
                    agentId: this.agentId,
                    uid: this.uid,
                    workdir: agentWorkdir(this.agentId),
                },
            };
        }
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    /**
     * Ensure the container exists and this agent has a directory in it, once per
     * handle. Memoized, and cleared on failure so the next command retries rather
     * than inheriting a rejected promise.
     */
    private _ensureProvisioned(): Promise<void> {
        if (!this._provisioned) {
            this._provisioned = this._client
                .ensureSandbox({
                    organizationId: this.organizationId,
                    ...(this._image ? { image: this._image } : {}),
                    agents: [{ agentId: this.agentId, uid: this.uid }],
                })
                .then(() => undefined)
                .catch((error: unknown) => {
                    this._provisioned = undefined;
                    throw error;
                });
        }
        return this._provisioned;
    }

    /**
     * Run `task`, and if the service says this agent has no directory, create it
     * and try once more.
     *
     * That answer is expected rather than exceptional: the container may have
     * been rebuilt after a reap, or the agent may be brand new. The service
     * recovers the roster from the volume, so one provision is all it takes.
     */
    private async _withAgentProvisioned<T>(task: () => Promise<T>): Promise<T> {
        await this._ensureProvisioned();
        try {
            return await task();
        } catch (error) {
            if (!(error instanceof SandboxServiceError) || !error.isAgentNotProvisioned) {
                throw error;
            }
            await this._client.ensureAgent(this.organizationId, {
                agentId: this.agentId,
                uid: this.uid,
            });
            return task();
        }
    }
}

/** Drop undefined entries — the wire format only carries strings. */
function toStringRecord(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") result[key] = value;
    }
    return result;
}
