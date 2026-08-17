/**
 * One long-lived Docker container per organization, shared by all of that
 * organization's agents.
 *
 * ```
 *  gateway ──HTTP──▶ this service ──docker CLI──▶ container  (one per org)
 *                                                 └─ volume  hyros-workspace-<org>
 *                                                    /workspace/<agentId>  uid, 0700
 * ```
 *
 * The container boundary separates organizations; the OS uid separates agents
 * inside one. A directory alone would not — it is a starting point, not a wall.
 *
 * State lives in the named volume, nowhere else. Nothing is mirrored to object
 * storage, so:
 *
 *   - destroying or reaping a container loses no work,
 *   - the roster (which agent owns which uid) is *read back* from the volume
 *     rather than remembered, so a service restart recovers it,
 *   - a restart adopts running containers instead of recreating them.
 *
 * Ownership work needs CAP_CHOWN, which the sandbox container deliberately does
 * not have (`--cap-drop=ALL`). So directory setup runs in a short-lived
 * provisioner container with the volume attached — see `_runProvisioner`.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { SandboxError } from "./errors.js";
import {
    agentTmpDir,
    agentWorkdir,
    containerName,
    isValidAgentId,
    isValidUid,
    networkName,
    resolveAgentPath,
    SHARED_DIR,
    volumeName,
    WORKSPACE_ROOT,
    type PathAccess,
} from "./layout.js";
import { buildTreeProbe, parseTreeOutput, type ListTreeResult } from "./tree.js";

const execFileAsync = promisify(execFile);

/** Docker networks that always exist — anything else is created on demand. */
const BUILT_IN_NETWORKS = new Set(["none", "bridge", "host", "container"]);

/** Marks our containers so a restarted service can find and adopt them. */
export const SANDBOX_LABEL = "ai.hyros.sandbox";
export const ORGANIZATION_LABEL = "ai.hyros.sandbox.organization";

/**
 * Whether this Docker host refuses `--security-opt=no-new-privileges`.
 *
 * Snap-packaged Docker on AppArmor hosts (e.g. Ubuntu with `snap install
 * docker`) cannot start such containers at all: the daemon runs confined under
 * `snap.docker.dockerd`, moving to `docker-default` at the container's first
 * exec is an AppArmor profile transition, and no-new-privs forbids profile
 * transitions — every exec dies with `operation not permitted` before PID 1 even
 * runs.
 *
 * Detected from the failure itself (a dead container whose only output is that
 * error) rather than probed up front, and remembered process-wide — the daemon
 * doesn't change under us. Dropping the flag is safe for uid isolation because
 * the compensating controls stay on: `--cap-drop=ALL` empties the bounding set
 * (a setuid/file-caps binary can grant nothing), the sandbox image ships zero
 * setuid/sgid/file-caps binaries, the rootfs is read-only and /tmp is nosuid.
 */
let noNewPrivilegesBroken = false;

export interface SandboxAgent {
    agentId: string;
    uid: number;
}

export interface SandboxContainerOptions {
    /** The tenant. Names the container and the volume. */
    organizationId: string;
    image?: string;
    /**
     * Docker network. Defaults to this organization's own network, which gives
     * agents egress while keeping them off every other tenant's network. Pass
     * `none` for no networking at all, or a shared name to opt out of per-tenant
     * isolation deliberately.
     */
    network?: string;
    /** Read-only container rootfs. Default true. */
    readOnly?: boolean;
    dockerPath?: string;
    /** Per-command default when the caller sends no timeout. */
    defaultTimeoutMs?: number;
    /** Container-wide environment. Per-command env is passed at exec time. */
    env?: Record<string, string>;
    extraRunArgs?: string[];
}

export interface ExecuteOptions {
    agentId: string;
    timeoutMs?: number;
    env?: Record<string, string>;
    /** Must stay inside the agent's own directory; defaults to it. */
    cwd?: string;
    abortSignal?: AbortSignal;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
}

export interface ExecuteResult {
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

export interface WriteFileResult {
    success: boolean;
    path: string;
    bytesWritten: number;
    error?: string;
}

export interface ReadFileResult {
    success: boolean;
    path: string;
    /** base64 — the endpoint is binary-safe. */
    content: string;
    bytesRead: number;
    error?: string;
}

export interface SandboxContainerInfo {
    id: string;
    status: "pending" | "running" | "stopped";
    containerName: string;
    containerId?: string;
    volume: string;
    image: string;
    network: string;
    createdAt: string;
    agents: SandboxAgent[];
    resources: ResourceLimits;
}

interface ResourceLimits {
    memory: string;
    cpus: string;
    pidsLimit: number;
    tmpfsSize: string;
}

/**
 * Budget for a shared container, derived from the provisioned roster — clients
 * never set limits on a container they share with their siblings.
 */
function resourceLimitsFor(agentCount: number): ResourceLimits {
    const n = Math.max(agentCount, 1);
    return {
        memory: `${128 * (n + 1)}m`,
        cpus: `${0.5 * n}`,
        pidsLimit: 128 * n,
        tmpfsSize: `${64 * n}m`,
    };
}

export class SandboxContainer {
    readonly id: string;
    readonly containerName: string;
    readonly volumeName: string;
    status: "pending" | "running" | "stopped" = "pending";

    /**
     * Not readonly: an adopted container's real image and network are read back
     * off the container itself. Anything recoverable from Docker is recovered,
     * never remembered — the provisioner has to run the image the container
     * actually uses, and after a service restart the request that chose it is
     * long gone.
     */
    private _image: string;
    private _network: string;
    private readonly _readOnly: boolean;
    private readonly _dockerPath: string;
    private readonly _defaultTimeoutMs: number;
    private readonly _env: Record<string, string>;
    private readonly _extraRunArgs: string[];
    private readonly _createdAt = new Date();

    private _containerId: string | undefined;
    private _limits: ResourceLimits = resourceLimitsFor(0);
    /** agentId → uid, read back from the volume rather than remembered. */
    private _agents = new Map<string, number>();

    /**
     * Serializes everything that creates, replaces or provisions the container.
     *
     * One queue rather than one per concern: `start()` provisions and
     * `ensureAgent()` may create the container, so two locks would let those two
     * acquire them in opposite orders and deadlock. Everything that runs
     * `docker run` or `docker rm` queues here, and the internals it calls are
     * the unlocked `*Locked` variants.
     */
    private _queue: Promise<unknown> = Promise.resolve();

    constructor(options: SandboxContainerOptions) {
        this.id = options.organizationId;
        this.containerName = containerName(options.organizationId);
        this.volumeName = volumeName(options.organizationId);
        // `||` rather than `??` for the env vars: docker compose substitutes an
        // unset variable as the empty string, and `--network ""` is an error, not
        // a default.
        this._image = options.image || process.env.SANDBOX_IMAGE?.trim() || "hyros-sandbox";
        this._network =
            options.network ||
            process.env.SANDBOX_NETWORK?.trim() ||
            networkName(options.organizationId);
        this._readOnly = options.readOnly ?? true;
        this._dockerPath = options.dockerPath ?? "docker";
        this._defaultTimeoutMs =
            options.defaultTimeoutMs ?? (Number(process.env.SANDBOX_REQUEST_TIMEOUT_MS) || 180_000);
        this._env = options.env ?? {};
        this._extraRunArgs = options.extraRunArgs ?? [];
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Bring the container up, or adopt the one that is already running.
     *
     * Idempotent: two concurrent starts for the same organization queue behind
     * each other, and the second finds a running container. `created` reports
     * whether this call is the one that ran it — the caller answers 201 or 200
     * with it, so provisioning work can happen exactly once.
     */
    start(): Promise<{ created: boolean }> {
        return this._serialize(async () => ({ created: await this._startLocked() }));
    }

    /** @returns true when this call ran the container. */
    private async _startLocked(): Promise<boolean> {
        if (!(await this._isDockerAvailable())) {
            throw new SandboxError(
                'Docker daemon is not running or docker is not installed. Run "docker info" to diagnose.',
                "DOCKER_UNAVAILABLE",
            );
        }

        const state = await this._containerState();
        if (state === "running") {
            // The normal case for every request after the first, and for a
            // service that just restarted under a container that never stopped.
            await this._adoptRunningLocked();
            await this._loadRosterLocked();
            return false;
        }
        if (state === "stopped") {
            // A stopped container can't be exec'd into and carries stale run
            // args (limits, mounts). The volume holds the state, so replacing it
            // costs nothing.
            await this._dockerCmd(["rm", "-f", this.containerName]);
        }

        await this._ensureVolume();
        await this._launchLocked();
        await this._provisionRootLayout();
        await this._loadRosterLocked();
        return true;
    }

    /**
     * Runs `docker run -d` and verifies the container actually survived it.
     *
     * `docker run -d` exits 0 and prints an id even when the entrypoint dies
     * instantly (AppArmor refusing the exec, a missing binary, …). Trusting that
     * id used to put the sandbox into a silent loop: every command found the
     * container "stopped", recreated it, and failed the same way. A container
     * that is already dead here is a startup failure and must surface as one.
     *
     * The one failure handled rather than thrown is a host that refuses
     * `--security-opt=no-new-privileges` (see `noNewPrivilegesBroken`): the run
     * is retried once without the flag, loudly. If that retry dies too, the flag
     * was never the cause and the hardening is put back.
     *
     * Caller must already hold the queue.
     */
    private async _launchLocked(): Promise<void> {
        await this._ensureNetwork();
        let droppedNnpHere = false;

        for (;;) {
            const { stdout } = await this._dockerCmd(this._buildRunArgs());
            const containerId = stdout.trim();

            // An entrypoint the host refuses is dead within milliseconds; a
            // healthy `tail -f` outlives any pause. Give the daemon a moment to
            // record the exit.
            await new Promise((resolve) => setTimeout(resolve, 300));
            const { stdout: running } = await this._dockerCmd([
                "inspect",
                "--format",
                "{{.State.Running}}",
                containerId,
            ]);
            if (running.trim() === "true") {
                this._containerId = containerId;
                this.status = "running";
                return;
            }

            let output = "";
            try {
                const { stdout: out, stderr: err } = await this._dockerCmd(["logs", containerId]);
                output = `${out}${err}`.trim();
            } catch {
                // The error below still says the container died, just without
                // its output.
            }
            await this._dockerCmd(["rm", "-f", containerId]).catch(() => {});

            if (!noNewPrivilegesBroken && /operation not permitted/i.test(output)) {
                noNewPrivilegesBroken = true;
                droppedNnpHere = true;
                console.warn(
                    `[sandbox:${this.id}] host refuses --security-opt=no-new-privileges ` +
                        `(container exec died: "${output}"). Expected under snap-packaged Docker on ` +
                        `AppArmor hosts. Retrying without the flag — cap-drop=ALL, read-only rootfs ` +
                        `and nosuid /tmp remain in force.`,
                );
                continue;
            }

            // The run without the flag died as well, so the flag was never the
            // cause — the match above was some other "operation not permitted".
            // Restore it: leaving it off would silently unharden every later
            // container in this process, including on hosts where it works.
            if (droppedNnpHere) {
                noNewPrivilegesBroken = false;
                console.warn(
                    `[sandbox:${this.id}] retry without no-new-privileges failed too — restoring the flag.`,
                );
            }

            this.status = "stopped";
            throw new SandboxError(
                `Container ${this.containerName} exited immediately after start` +
                    (output ? `: ${output}` : ""),
                "CONTAINER_START_FAILED",
            );
        }
    }

    async stop(): Promise<void> {
        if (this._containerId) {
            try {
                await this._dockerCmd(["stop", "-t", "5", this._containerId]);
            } catch {
                // Already stopped.
            }
        }
        this.status = "stopped";
    }

    /**
     * Remove the container. The volume — and therefore every agent's work —
     * survives unless `purgeVolume` is set, which is how a reap can be cheap and
     * a tenant deletion can still be complete.
     */
    async destroy(options: { purgeVolume?: boolean } = {}): Promise<void> {
        return this._serialize(async () => {
            // By name when we never inspected it: an adopted container from a
            // previous process has no id here, and reaping it must still work.
            try {
                await this._dockerCmd(["rm", "-f", this._containerId ?? this.containerName]);
            } catch {
                // Already removed.
            }
            this._containerId = undefined;
            this.status = "stopped";
            this._agents.clear();
            await this._removeOwnNetwork();

            if (options.purgeVolume) {
                try {
                    await this._dockerCmd(["volume", "rm", this.volumeName]);
                } catch (error) {
                    console.warn(
                        `[sandbox:${this.id}] volume ${this.volumeName} not removed: ${
                            (error as Error).message
                        }`,
                    );
                }
            }
        });
    }

    // ─── Agents ──────────────────────────────────────────────────────────────

    get agents(): SandboxAgent[] {
        return [...this._agents].map(([agentId, uid]) => ({ agentId, uid }));
    }

    hasAgent(agentId: string): boolean {
        return this._agents.has(agentId);
    }

    /**
     * Give one agent its directory, owned by its uid, mode 0700.
     *
     * Idempotent and — unlike the S3-mount design this replaces — it never
     * recreates the container, because one volume serves every agent. A late
     * joiner is therefore invisible to whatever the other agents are running.
     */
    ensureAgent(agent: SandboxAgent): Promise<void> {
        return this._serialize(() => this._ensureAgentLocked(agent));
    }

    private async _ensureAgentLocked(agent: SandboxAgent): Promise<void> {
        if (!isValidAgentId(agent.agentId)) {
            throw new SandboxError(`Invalid agentId: ${agent.agentId}`, "INVALID_AGENT_ID");
        }
        if (!isValidUid(agent.uid)) {
            throw new SandboxError(
                `uid ${agent.uid} is outside the pool baked into the sandbox image`,
                "UID_OUT_OF_POOL",
            );
        }
        await this._ensureContainerAliveLocked();

        if (this._agents.get(agent.agentId) === agent.uid) return;

        const workdir = agentWorkdir(agent.agentId);
        await this._runProvisioner(
            // Ownership first, then mode: chmod on a directory we do not own yet
            // fails, and -R is cheap here because the directory is new (an
            // existing, correctly-owned one short-circuits above).
            'set -e; mkdir -p "$AGENT_TMP"; chown -R "$AGENT_UID:$AGENT_UID" "$AGENT_DIR"; ' +
                'chmod 700 "$AGENT_DIR" "$AGENT_TMP"',
            {
                AGENT_DIR: workdir,
                AGENT_TMP: agentTmpDir(agent.agentId),
                AGENT_UID: String(agent.uid),
            },
        );

        this._agents.set(agent.agentId, agent.uid);
        await this._applyResourceLimits();
    }

    /**
     * Take over a container that is already running: its id, and the image and
     * network it was actually started with.
     *
     * The image matters beyond bookkeeping — the provisioner runs it, so a
     * container started with something other than the configured default would
     * otherwise be provisioned with the wrong image after a service restart.
     *
     * Caller must already hold the queue.
     */
    private async _adoptRunningLocked(): Promise<void> {
        const { stdout } = await this._dockerCmd([
            "inspect",
            "--format",
            "{{.Id}}|{{.Config.Image}}|{{.HostConfig.NetworkMode}}",
            this.containerName,
        ]);
        const [containerId, image, network] = stdout.trim().split("|");
        this._containerId = containerId;
        if (image && image !== this._image) {
            console.log(`[sandbox:${this.id}] adopted image ${image} (configured: ${this._image})`);
            this._image = image;
        }
        if (network) this._network = network;
        this.status = "running";
    }

    /**
     * Read the roster back off the volume: a directory under `/workspace` is an
     * agent, and its owner uid is that agent's uid. The volume is the source of
     * truth, so this survives a service restart with no bookkeeping of ours.
     *
     * Caller must already hold the queue.
     */
    private async _loadRosterLocked(): Promise<void> {
        const listing = await this._execRaw([
            "sh",
            "-c",
            // The glob skips dotfiles, so `.shared` and `.tmp` never look like
            // agents. `exit 0` at the end matters: an empty workspace leaves the
            // glob unexpanded, the `[ -d ]` test fails, and the loop would
            // otherwise make the whole script exit non-zero.
            'for d in /workspace/*/; do [ -d "$d" ] || continue; ' +
                'printf "%s %s\\n" "$(basename "$d")" "$(stat -c %u "$d")"; done; exit 0',
        ]);
        if (!listing.success) {
            // A failure here is a real one (container gone, image without stat).
            console.warn(
                `[sandbox:${this.id}] could not read roster from volume: ${listing.stderr.trim()}`,
            );
            return;
        }

        const agents = new Map<string, number>();
        for (const line of listing.stdout.split("\n")) {
            const [agentId, rawUid] = line.trim().split(/\s+/);
            if (!agentId || !rawUid) continue;
            const uid = Number(rawUid);
            if (isValidAgentId(agentId) && isValidUid(uid)) agents.set(agentId, uid);
        }
        this._agents = agents;
        await this._applyResourceLimits();
    }

    // ─── Commands ────────────────────────────────────────────────────────────

    /**
     * Run a command as one agent: its uid, its directory, HOME and TMPDIR inside
     * that directory. All four or none — a bare `-u` leaves the process in
     * another agent's directory with an unwritable HOME.
     */
    async executeCommand(
        command: string,
        args: string[] | undefined,
        options: ExecuteOptions,
    ): Promise<ExecuteResult> {
        const agent = await this._requireAgent(options.agentId);
        const cwd = options.cwd
            ? resolveAgentPath(options.agentId, options.cwd, "write")
            : agentWorkdir(options.agentId);
        if (!cwd) {
            throw new SandboxError(
                `cwd is outside the agent's workspace: ${options.cwd}`,
                "PATH_OUTSIDE_WORKSPACE",
            );
        }

        const fullCommand = args?.length ? `${command} ${args.join(" ")}` : command;
        const timeoutMs = options.timeoutMs ?? this._defaultTimeoutMs;
        const startedAt = Date.now();

        const execArgs = ["exec", ...this._agentExecArgs(options.agentId, agent, cwd)];
        for (const [key, value] of Object.entries(options.env ?? {})) {
            execArgs.push("--env", `${key}=${value}`);
        }
        execArgs.push(this._containerId!, "sh", "-c", fullCommand);

        return new Promise<ExecuteResult>((resolve) => {
            const child = spawn(this._dockerPath, execArgs, { stdio: "pipe" });

            let stdout = "";
            let stderr = "";
            let timedOut = false;
            let killed = false;
            let settled = false;

            const settle = (exitCode: number) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({
                    success: exitCode === 0,
                    exitCode,
                    stdout,
                    stderr,
                    executionTimeMs: Date.now() - startedAt,
                    timedOut,
                    killed,
                    command,
                    args,
                });
            };

            const timer = setTimeout(() => {
                timedOut = true;
                killed = true;
                child.kill("SIGKILL");
            }, timeoutMs);

            options.abortSignal?.addEventListener(
                "abort",
                () => {
                    killed = true;
                    child.kill("SIGKILL");
                },
                { once: true },
            );

            child.stdout.on("data", (data: Buffer) => {
                const chunk = data.toString();
                stdout += chunk;
                options.onStdout?.(chunk);
            });
            child.stderr.on("data", (data: Buffer) => {
                const chunk = data.toString();
                stderr += chunk;
                options.onStderr?.(chunk);
            });
            child.on("close", (code) => settle(code ?? 1));
            child.on("error", (error) => {
                stderr += error.message;
                settle(1);
            });
        });
    }

    // ─── Files ───────────────────────────────────────────────────────────────

    /**
     * Write a file as the agent, via stdin.
     *
     * `dd of=` rather than `sh -c "cat > '<path>'"`: an arg array kills
     * shell-quoting injection, and unlike `tee` it doesn't echo the payload back
     * on stdout. Bypasses ARG_MAX, so large payloads are safe.
     */
    async writeFile(
        agentId: string,
        filePath: string,
        content: string,
        encoding: "utf-8" | "base64" = "utf-8",
    ): Promise<WriteFileResult> {
        const agent = await this._requireAgent(agentId);
        const target = this._resolveOrThrow(agentId, filePath, "write");
        const payload = Buffer.from(content, encoding === "base64" ? "base64" : "utf-8");

        const directory = target.slice(0, target.lastIndexOf("/"));
        if (directory) {
            const mkdir = await this.executeCommand("mkdir", ["-p", directory], { agentId });
            if (!mkdir.success) {
                return {
                    success: false,
                    path: target,
                    bytesWritten: 0,
                    error: mkdir.stderr.trim() || `mkdir failed (exit ${mkdir.exitCode})`,
                };
            }
        }

        return new Promise<WriteFileResult>((resolve) => {
            const execArgs = [
                "exec",
                "-i",
                ...this._agentExecArgs(agentId, agent, agentWorkdir(agentId)),
                this._containerId!,
                "dd",
                `of=${target}`,
            ];
            const child = spawn(this._dockerPath, execArgs, { stdio: ["pipe", "pipe", "pipe"] });

            let stderr = "";
            child.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });
            child.on("close", (code) => {
                resolve(
                    code === 0
                        ? { success: true, path: target, bytesWritten: payload.length }
                        : {
                              success: false,
                              path: target,
                              bytesWritten: 0,
                              error: stderr.trim() || `exit code ${code}`,
                          },
                );
            });
            child.on("error", (error) => {
                resolve({ success: false, path: target, bytesWritten: 0, error: error.message });
            });
            child.stdin.end(payload);
        });
    }

    /** Read a file as the agent. Returns base64 so binaries survive the trip. */
    async readFile(agentId: string, filePath: string): Promise<ReadFileResult> {
        const agent = await this._requireAgent(agentId);
        const target = this._resolveOrThrow(agentId, filePath, "read");

        return new Promise<ReadFileResult>((resolve) => {
            const execArgs = [
                "exec",
                ...this._agentExecArgs(agentId, agent, agentWorkdir(agentId)),
                this._containerId!,
                "cat",
                target,
            ];
            const child = spawn(this._dockerPath, execArgs, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            const chunks: Buffer[] = [];
            let stderr = "";
            child.stdout.on("data", (data: Buffer) => chunks.push(data));
            child.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });
            child.on("close", (code) => {
                if (code === 0) {
                    const buffer = Buffer.concat(chunks);
                    resolve({
                        success: true,
                        path: target,
                        content: buffer.toString("base64"),
                        bytesRead: buffer.length,
                    });
                } else {
                    resolve({
                        success: false,
                        path: target,
                        content: "",
                        bytesRead: 0,
                        error: stderr.trim() || `exit code ${code}`,
                    });
                }
            });
            child.on("error", (error) => {
                resolve({
                    success: false,
                    path: target,
                    content: "",
                    bytesRead: 0,
                    error: error.message,
                });
            });
        });
    }

    /**
     * List everything under one or more directories, in a single exec.
     *
     * Serves skill discovery, which stats and lists far more often than it reads.
     * Roots are resolved with read access, so `.shared` is listable and another
     * agent's directory is not — and the probe runs as the agent's own uid, so
     * the kernel refuses it even if this check were wrong.
     */
    async listTree(
        agentId: string,
        roots: string[],
        maxDepth: number = 4,
    ): Promise<ListTreeResult> {
        const resolved = roots.map((root) => this._resolveOrThrow(agentId, root, "read"));
        if (resolved.length === 0) return { entries: [], truncated: false };

        const probe = await this.executeCommand(buildTreeProbe(resolved, maxDepth), undefined, {
            agentId,
        });
        // The probe exits 0 even with nothing to list, so a non-zero code means
        // the exec itself failed and there is nothing to parse.
        if (!probe.success) {
            throw new SandboxError(
                probe.stderr.trim() || `listing failed (exit ${probe.exitCode})`,
                "DOCKER_UNAVAILABLE",
            );
        }
        return parseTreeOutput(probe.stdout);
    }

    // ─── Info ────────────────────────────────────────────────────────────────

    getInfo(): SandboxContainerInfo {
        return {
            id: this.id,
            status: this.status,
            containerName: this.containerName,
            containerId: this._containerId,
            volume: this.volumeName,
            image: this._image,
            network: this._network,
            createdAt: this._createdAt.toISOString(),
            agents: this.agents,
            resources: this._limits,
        };
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    /** Runs `task` after every queued container operation, whatever their outcome. */
    private _serialize<T>(task: () => Promise<T>): Promise<T> {
        const result = this._queue.then(task, task);
        this._queue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private async _requireAgent(agentId: string): Promise<number> {
        await this._ensureContainerAlive();
        const uid = this._agents.get(agentId);
        if (uid === undefined) {
            throw new SandboxError(
                `Agent ${agentId} has no workspace in this sandbox. Provision it first.`,
                "AGENT_NOT_PROVISIONED",
            );
        }
        return uid;
    }

    private _resolveOrThrow(agentId: string, filePath: string, access: PathAccess): string {
        const resolved = resolveAgentPath(agentId, filePath, access);
        if (!resolved) {
            throw new SandboxError(
                `Path is outside what this agent may ${access}: ${filePath}`,
                "PATH_OUTSIDE_WORKSPACE",
            );
        }
        return resolved;
    }

    private _agentExecArgs(agentId: string, uid: number, cwd: string): string[] {
        return [
            "-u",
            String(uid),
            "-w",
            cwd,
            "--env",
            `HOME=${agentWorkdir(agentId)}`,
            "--env",
            `TMPDIR=${agentTmpDir(agentId)}`,
        ];
    }

    /**
     * Verify the container is alive, recreating it if it went away (manual
     * `docker rm`, OOM kill, daemon restart, or a reap this process never saw).
     */
    private async _ensureContainerAlive(): Promise<void> {
        // Fast path: a healthy container is the overwhelmingly common case, and
        // every command goes through here — no reason to serialize it.
        if (this._containerId && (await this._containerState()) === "running") return;
        return this._serialize(() => this._ensureContainerAliveLocked());
    }

    private async _ensureContainerAliveLocked(): Promise<void> {
        // Re-check inside the queue. Concurrent commands on a cold sandbox all
        // reach the check above before any of them has created anything; without
        // this second look they would each run `docker run --name <same>` and
        // every one but the winner would fail with a name conflict.
        const state = await this._containerState();
        if (state === "running") {
            if (!this._containerId) await this._adoptRunningLocked();
            return;
        }
        console.log(`[sandbox:${this.id}] container ${state}, (re)starting`);
        await this._startLocked();
    }

    /**
     * Root-owned `/workspace` and `.shared`. Runs once per container creation;
     * a fresh volume mounts as root:root 0755 anyway, but `.shared` has to exist
     * before anything can read from it.
     */
    private async _provisionRootLayout(): Promise<void> {
        await this._runProvisioner(
            'set -e; mkdir -p "$WORKSPACE" "$SHARED"; chown 0:0 "$WORKSPACE" "$SHARED"; ' +
                'chmod 755 "$WORKSPACE" "$SHARED"',
            { WORKSPACE: WORKSPACE_ROOT, SHARED: SHARED_DIR },
        );
    }

    /**
     * Run a setup script as root against the volume, in a throwaway container.
     *
     * The sandbox container runs `--cap-drop=ALL`, so even its root cannot
     * chown. Rather than weaken that for the container agents live in, ownership
     * work happens here: no network, nothing mounted but the volume, gone the
     * moment it exits.
     *
     * Values reach the script as environment variables, never interpolated into
     * the command string — ids come from the request, and `--env` values are not
     * shell-parsed.
     */
    private async _runProvisioner(script: string, env: Record<string, string>): Promise<void> {
        const args = [
            "run",
            "--rm",
            "--network",
            "none",
            "--user",
            "0:0",
            "-v",
            `${this.volumeName}:${WORKSPACE_ROOT}`,
        ];
        for (const [key, value] of Object.entries(env)) {
            args.push("--env", `${key}=${value}`);
        }
        args.push(this._image, "sh", "-c", script);
        await this._dockerCmd(args);
    }

    /**
     * Push the roster-derived budget onto the running container.
     *
     * `docker update` rather than a recreate: the whole point of one volume is
     * that a new agent never disturbs work already in flight. Best-effort —
     * some kernels refuse individual updates, and a container running with a
     * slightly stale budget is better than a failed provision.
     */
    private async _applyResourceLimits(): Promise<void> {
        const next = resourceLimitsFor(this._agents.size);
        // tmpfsSize is not compared: `docker update` cannot resize a tmpfs, so
        // /tmp keeps whatever the container was created with until it is
        // recreated. Growing it is not worth disturbing running work for.
        const unchanged =
            next.memory === this._limits.memory &&
            next.cpus === this._limits.cpus &&
            next.pidsLimit === this._limits.pidsLimit;
        this._limits = next;
        if (unchanged || !this._containerId) return;

        try {
            await this._dockerCmd([
                "update",
                "--memory",
                next.memory,
                "--memory-swap",
                next.memory,
                "--cpus",
                next.cpus,
                "--pids-limit",
                String(next.pidsLimit),
                this._containerId,
            ]);
        } catch (error) {
            console.warn(
                `[sandbox:${this.id}] could not update resource limits: ${(error as Error).message}`,
            );
        }
    }

    /** A short root exec used for introspection (roster, stats). */
    private async _execRaw(command: string[]): Promise<{
        success: boolean;
        stdout: string;
        stderr: string;
    }> {
        try {
            const { stdout, stderr } = await execFileAsync(
                this._dockerPath,
                ["exec", this._containerId!, ...command],
                { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
            );
            return { success: true, stdout, stderr };
        } catch (error) {
            const err = error as { stdout?: string; stderr?: string; message: string };
            return {
                success: false,
                stdout: err.stdout ?? "",
                stderr: err.stderr ?? err.message,
            };
        }
    }

    private _buildRunArgs(): string[] {
        const args = [
            "run",
            "-d",
            "--name",
            this.containerName,
            "--label",
            `${SANDBOX_LABEL}=1`,
            "--label",
            `${ORGANIZATION_LABEL}=${this.id}`,
            "-w",
            WORKSPACE_ROOT,
            "-v",
            `${this.volumeName}:${WORKSPACE_ROOT}`,
            "--memory",
            this._limits.memory,
            "--cpus",
            this._limits.cpus,
            "--pids-limit",
            String(this._limits.pidsLimit),
            "--network",
            this._network,
            // Empty the capability bounding set: a setuid or file-caps binary can
            // then grant nothing, which is what keeps uid separation meaningful.
            "--cap-drop=ALL",
        ];

        if (!noNewPrivilegesBroken) {
            args.push("--security-opt=no-new-privileges");
        }

        if (this._readOnly) {
            // Explicit tmpfs options: passing only `size=` drops Docker's
            // defaults, which is how a "nosuid /tmp" claim quietly stops being
            // true. exec stays allowed — installers and interpreters need it.
            args.push(
                "--read-only",
                "--tmpfs",
                `/tmp:rw,nosuid,nodev,mode=1777,size=${this._limits.tmpfsSize}`,
            );
        }

        for (const [key, value] of Object.entries(this._env)) {
            args.push("--env", `${key}=${value}`);
        }
        args.push(...this._extraRunArgs);
        // PID 1 that outlives every exec and costs nothing.
        args.push(this._image, "tail", "-f", "/dev/null");
        return args;
    }

    private async _ensureVolume(): Promise<void> {
        try {
            await this._dockerCmd(["volume", "inspect", this.volumeName]);
            return;
        } catch {
            // Not created yet.
        }
        try {
            await this._dockerCmd([
                "volume",
                "create",
                "--label",
                `${SANDBOX_LABEL}=1`,
                "--label",
                `${ORGANIZATION_LABEL}=${this.id}`,
                this.volumeName,
            ]);
        } catch {
            // Lost a race with another request — the volume exists either way,
            // and a failing inspect here is a real error worth surfacing.
            await this._dockerCmd(["volume", "inspect", this.volumeName]);
        }
    }

    /**
     * The organization's own network, created on demand.
     *
     * A user-defined bridge gives the container NAT egress — agents need the
     * internet — while keeping it off every other tenant's network: Docker
     * isolates separate bridges from each other, so one organization's container
     * cannot reach another's by IP. It also keeps them off the default bridge our
     * own services share, and gives the host firewall rule that blocks the cloud
     * metadata endpoint a stable target.
     *
     * Note the host-level ceiling: Docker's default address pools allow only
     * about 31 user-defined networks. A host serving more organizations than that
     * needs wider `default-address-pools` in daemon.json — see the README.
     */
    private async _ensureNetwork(): Promise<void> {
        if (BUILT_IN_NETWORKS.has(this._network)) return;
        try {
            await this._dockerCmd(["network", "inspect", this._network]);
            return;
        } catch {
            // Not created yet.
        }
        try {
            await this._dockerCmd([
                "network",
                "create",
                "--label",
                `${SANDBOX_LABEL}=1`,
                "--label",
                `${ORGANIZATION_LABEL}=${this.id}`,
                this._network,
            ]);
        } catch {
            // Lost a race with another request — the network exists either way,
            // and a failing inspect here is a real error worth surfacing.
            await this._dockerCmd(["network", "inspect", this._network]);
        }
    }

    /**
     * Release the organization's network once its container is gone.
     *
     * Networks are not free: each one takes a subnet out of Docker's address
     * pool, and the pool is small. Leaving them behind would let a host run out
     * of networks long before it runs out of capacity. Only ours are removed, and
     * only when nothing is attached — a shared or built-in network is left alone.
     */
    private async _removeOwnNetwork(): Promise<void> {
        if (this._network !== networkName(this.id)) return;
        try {
            await this._dockerCmd(["network", "rm", this._network]);
        } catch {
            // Still has endpoints, or already gone. Neither is worth failing a
            // destroy over — the reaper or the next create will settle it.
        }
    }

    private async _dockerCmd(args: string[]): Promise<{ stdout: string; stderr: string }> {
        try {
            const { stdout, stderr } = await execFileAsync(this._dockerPath, args, {
                timeout: 60_000,
                maxBuffer: 4 * 1024 * 1024,
            });
            return { stdout, stderr };
        } catch (error) {
            const err = error as NodeJS.ErrnoException & {
                stderr?: string;
                killed?: boolean;
                signal?: string;
            };
            if (err.code === "ENOENT") {
                throw new SandboxError(
                    `Docker binary not found at "${this._dockerPath}".`,
                    "DOCKER_NOT_FOUND",
                );
            }
            if (err.killed || err.signal) {
                throw new SandboxError(
                    `Docker command timed out: docker ${args.join(" ")}`,
                    "DOCKER_TIMEOUT",
                );
            }
            throw new SandboxError(
                `Docker command failed: docker ${args.join(" ")}\n${err.stderr ?? err.message}`,
                "DOCKER_CMD_FAILED",
            );
        }
    }

    private async _isDockerAvailable(): Promise<boolean> {
        try {
            await this._dockerCmd(["info"]);
            return true;
        } catch {
            return false;
        }
    }

    private async _containerState(): Promise<"running" | "stopped" | "none"> {
        try {
            const { stdout } = await this._dockerCmd([
                "inspect",
                "--format",
                "{{.State.Running}}",
                this.containerName,
            ]);
            return stdout.trim() === "true" ? "running" : "stopped";
        } catch {
            return "none";
        }
    }
}

/**
 * Organization ids of every container this service has ever created that is
 * still around, running or not.
 *
 * Used at boot so a restarted service adopts its containers instead of leaking
 * them: without it an orphan keeps a tenant's CPU and memory reserved with
 * nothing left to reap it.
 */
export async function listExistingOrganizations(dockerPath = "docker"): Promise<string[]> {
    try {
        const { stdout } = await execFileAsync(
            dockerPath,
            [
                "ps",
                "-a",
                "--filter",
                `label=${SANDBOX_LABEL}=1`,
                "--format",
                `{{.Label "${ORGANIZATION_LABEL}"}}`,
            ],
            { timeout: 30_000 },
        );
        return stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    } catch (error) {
        console.warn(`[sandbox] could not list existing containers: ${(error as Error).message}`);
        return [];
    }
}
