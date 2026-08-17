# Sandbox Security

Security analysis of the sandbox system: this service, the container it manages,
and the gateway-side client that drives it.

---

## Current mitigations (already in place)

| Control                    | Implementation                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-organization isolation | One container per organization; agents inside it are separated by uid                                                                                                         |
| Per-agent OS uid           | `docker exec -u <uid> -w <workdir>` against `0700` directories — the kernel refuses cross-agent reads. Verified end to end 2026-08-17 (see below)                              |
| uid pool enforcement       | The service refuses a uid outside the pool baked into the image, so an exec can never run as a uid with no OS user                                                             |
| Server-side path jail      | `write-file` / `read-file` / `list-tree` resolve the path and reject anything outside the agent's directory, `..` included. Reads may reach `.shared`; writes may not             |
| Org skills are operator-only | An org-wide skill changes how every agent in the tenant behaves, so no agent can install one: `.shared` is root-owned, the agent execs as its own uid, and the path jail refuses writes there. Installing one is a root action inside the container (see README). An agent's own skills stay in its `0700` directory, invisible to its siblings |
| Skill discovery is unprivileged | Skills are listed and read through `list-tree` / `read-file` as the agent's own uid, so discovery cannot see anything the agent could not read itself. Symlinks are reported but never followed, so a link out of the workspace cannot be read through it |
| Read-only root filesystem  | `--read-only`; the only writable places are the organization's volume and `/tmp`                                                                                               |
| Capabilities dropped       | `--cap-drop=ALL --security-opt=no-new-privileges` (NNP auto-dropped on hosts that refuse it, see below)                                                                        |
| Hardened `/tmp`            | `--tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=…` — explicit options, because passing only `size=` silently drops Docker's defaults                                              |
| Volume-only storage        | No host bind mounts. The only mount is the organization's named Docker volume; nothing can ask for a host path                                                                 |
| Root work quarantined      | Ownership setup needs `CAP_CHOWN`, which the agents' container does not have. It runs in a throwaway provisioner container: root, no network, nothing mounted but the volume    |
| No shell interpolation     | Ids reach the provisioner as `--env` values, never spliced into the command string, and are validated against a conservative token pattern first                               |
| Resource limits            | Memory, CPU, PID and tmpfs caps derived from how many agents actually have a directory — clients cannot set them. Growth applies via `docker update`, never a container recreate |
| Per-tenant network         | Each organization gets its own user-defined bridge (`hyros-net-<org>`), created with the container and removed with it: egress works, but one tenant cannot reach another by IP, and none of them land on the default bridge our own services share |
| Bearer token auth          | `SANDBOX_SERVICE_TOKEN`, checked in `onRequest` — before body parsing and validation, so an unauthenticated caller cannot even probe the request schema                          |
| Concurrency caps           | Per-organization (default 3) and global (default 24), bounded queue → `429`                                                                                                   |
| Command timeout ceiling    | A client-supplied timeout is clamped to `SANDBOX_REQUEST_TIMEOUT_MS`, so one command cannot park a slot forever                                                                |
| Non-destructive reaping    | The TTL reaper removes containers, never volumes. Only an explicit `?purgeVolume=1` deletes data                                                                               |

### uid isolation now holds on Docker Desktop for macOS too

The previous design bind-mounted host staging directories into the container.
macOS-shared bind mounts use a `fakeowner` filesystem, which reports fabricated
ownership per caller — mode bits were inert there, and an agent could read a
sibling's `0700` directory.

Named volumes are not shared from macOS: they live in the Linux VM's own
filesystem, so ordinary uid and mode semantics apply. Verified 2026-08-17 on
Docker Desktop 27.4.0: with `agent-a` (uid 10000) and `agent-b` (uid 10001) in one
container, `cat /workspace/agent-a/secret.txt` as `agent-b` returned
`Permission denied`, and writing into root-owned `.shared` was refused.

This is a property of using volumes rather than bind mounts. Reintroducing a host
bind mount for workspaces would bring the macOS caveat back with it — and on any
host, `grep fakeowner /proc/mounts` returning something means mode bits are not
being enforced where it matters.

The kernel is the real boundary. The gateway-side client adds one narrow
tool-layer check (`assertOwnWorkspacePaths`) that refuses commands naming another
agent's directory: a second line, not a replacement for one.

### no-new-privileges is dropped automatically under snap-packaged Docker

On AppArmor hosts where Docker is installed as a snap (`snap install docker`), the
daemon runs confined under the `snap.docker.dockerd` profile. Entering
`docker-default` at the container's first exec is an AppArmor profile transition,
and `no_new_privs` forbids profile transitions — so with
`--security-opt=no-new-privileges` **every** container exec dies with
`exec …: operation not permitted` before PID 1 runs. `apparmor=unconfined` does not
help; that transition is forbidden too.

`_launchLocked()` in `src/container.ts` detects this exact signature (a container
dead immediately after `docker run -d` whose only output is that error), logs a
warning, and retries once without the flag, remembering the answer process-wide.
Any other immediate death surfaces as `CONTAINER_START_FAILED` instead of a silent
recreate loop.

Dropping NNP there does not undo uid isolation, because the controls that make
setuid/file-caps binaries inert stay on: `--cap-drop=ALL` empties the capability
bounding set (even a setuid-root exec gains euid 0 with **zero** capabilities — no
`CAP_DAC_OVERRIDE`, so `0700` directories still refuse it), the image ships no
setuid/sgid/file-caps binaries, the rootfs is read-only, and `/tmp` is `nosuid`.
Production hosts on docker-ce keep NNP; the fallback never triggers there.

---

## P1 — Should fix before production

### 1. The volume is the only copy of an agent's work

Removing the sync layer made the named volume the source of truth, which is what
makes reaping, restarts and late joins cheap. It also means a lost host loses the
tenant's workspace, and there is no backup yet.

**What holds today:** anything the product cannot afford to lose is expected to
live in Postgres (chat, profiles, schedules, and published skills), with the volume
holding working state and materialised files. That invariant is doing real work —
if durable-only-in-the-volume data ever appears, this becomes a data-loss bug.

**Recommendation:** a periodic snapshot per volume to object storage, plus one on
container destroy:

```bash
docker run --rm -v hyros-workspace-<org>:/data alpine tar czf - -C /data . \
  | rclone rcat r2:hyros-workspace-backups/<org>/$(date +%F-%H%M).tar.gz
```

One-directional, no conflict model, restore is a rare manual operation.

### 2. Organizations are pinned to a host

A named volume is host-local, so an organization must come back on the host that
holds its volume. Fine with a single sandbox host; a fleet needs an organization →
host mapping in front of this service, or a shared filesystem.

### 3. No TLS between gateway and sandbox-service

Commands, output, file paths, and any environment variables passed to a command
cross the network in plaintext.

**Impact:** irrelevant on localhost, significant cross-host.

**Recommendation:** TLS termination in front of the service, a private network, or
mTLS in place of the shared secret.

### 4. Cloud metadata endpoint reachable — needs a host firewall rule

Agents have egress by default now (their own per-organization bridge), so this
rule is **required**, not advisory: without it a sandbox can read cloud
credentials from `169.254.169.254`. Docker cannot block it — the container has
`--cap-drop=ALL` and cannot alter its own routes, but the host has to drop the
traffic. One rule in `DOCKER-USER` covers every organization network.

**Required deploy step**, once per sandbox host, made persistent:

```bash
iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
```

Verify from inside a sandbox: `curl -m 2 http://169.254.169.254/` must time out.

---

## P2 — Should fix for hardened production

### 5. No cap on how many organizations one host will serve

Unlimited container creation can exhaust the host. Reject creation past a
configurable maximum, and report it as a distinct code so the gateway can route
elsewhere rather than retry.

There is also a hard ceiling nobody chose: Docker's default address pools allow
roughly 31 user-defined networks, and each organization now takes one. Past that,
`docker network create` fails with "could not find an available, non-overlapping
IPv4 address pool" and container creation fails with it. Widen the pool in
`/etc/docker/daemon.json` before a host gets near it:

```json
{ "default-address-pools": [{ "base": "10.200.0.0/16", "size": 24 }] }
```

### 6. No audit logging

Nothing records which containers were created, what ran in them, or who destroyed
what. Structured JSON per operation, with the organization and agent on every line:

```json
{"event":"sandbox.create","organizationId":"…","image":"hyros-sandbox","ts":"…"}
{"event":"sandbox.exec","organizationId":"…","agentId":"…","exitCode":0,"ms":142}
{"event":"sandbox.destroy","organizationId":"…","purgedVolume":false,"reason":"reaper"}
```

This matters more now that an agent can install software into a workspace: the
audit trail is how "where did this come from" gets answered.

### 7. Shared `/tmp` across agents

`/tmp` is one `mode=1777` tmpfs for the whole container, so agents share it. Each
agent's `TMPDIR` points inside its own `0700` directory, which is where anything
sensitive should land; `/tmp` remains world-writable by design for tooling that
ignores `TMPDIR`. Per-agent tmpfs mounts would close the gap at the cost of a
mount per agent.

---

## P3 — Defense in depth

### 8. Container runtime isolation (gVisor / Kata)

Standard containers share the host kernel, so a kernel exploit from inside is a
host compromise. For multi-tenant production consider gVisor (`runsc`, user-space
kernel, ~5–10% overhead) or Kata (lightweight VM per container). Both plug in via
`extraRunArgs: ["--runtime=runsc"]`.

### 9. Seccomp profile

Containers may make any syscall Docker's default profile allows (~300). A custom
profile covering only what the sandbox image needs would cut that surface:

```bash
docker run --security-opt seccomp=hyros-sandbox-seccomp.json …
```

### 10. Image supply chain

`hyros-sandbox` builds from `python:3.12-alpine` and installs via `apk` and `pip`,
none of it pinned. Pin base digests rather than tags, pin package versions, scan
with Trivy or Grype before deploy, and rebuild on a schedule for patches.

---

## Summary

```
Mitigated                      P1 (before production)      P2 (hardened prod)        P3 (defense in depth)
────────────────────────────   ─────────────────────────   ───────────────────────   ─────────────────────
Per-agent uid + 0700           Volume backup (only copy)   Max organizations/host    gVisor / Kata runtime
Server-side path jail          Host affinity mapping       Wider address pools       Seccomp profile
uid pool enforcement           TLS / private network       Audit logging             Image supply chain
Volume-only mounts             Metadata firewall (host)    Per-agent /tmp
Per-tenant network
Root work in a throwaway
cap-drop=ALL (+ NNP)
Read-only rootfs, nosuid /tmp
Resource caps from the roster
Concurrency caps + clamps
Non-destructive reaping
Bearer token auth
```
