# @hyros-ai/sandbox-service

Agents run code — shell commands, Python, installs, whatever a task needs. This
service is where that code runs: an HTTP API in front of Docker, on a host with a
Docker daemon.

Security analysis and open items: [SANDBOX-SECURITY.md](./SANDBOX-SECURITY.md).

## The model: one container per organization, one volume behind it

```
┌─ gateway ──────────────────┐        ┌─ sandbox host ──────────────────────────────┐
│  sandbox client ──fetch()──────────▶│  this service ──docker CLI──▶ container      │
│  (one handle per agent)    │        │                               per organization│
└────────────────────────────┘        │                                    │          │
                                      │            hyros-workspace-<org>   │ volume   │
                                      │              /workspace            ▼          │
                                      │                .shared/     root   0755       │
                                      │                <agentA>/    10000  0700       │
                                      │                <agentB>/    10001  0700       │
                                      └──────────────────────────────────────────────┘
```

The sandbox `id` is the **organization id**. Every agent in that organization
shares the container, and each one:

- gets its own directory, `/workspace/<agentId>`, mode `0700`
- runs as its own OS uid, via `docker exec -u <uid> -w <workdir>`
- has `HOME` and `TMPDIR` pointed inside its own directory

So the container boundary separates organizations, and the uid separates agents
inside one. A directory alone would not — it is a starting point, not a wall.

`.shared/` is root-owned and mode `0755`: readable by every agent in the
organization, writable by none. Org-wide material (global skills) belongs there.

uids come from a pool baked into the image at build time (`agent0…agent63`, uids
10000–10063). They must be baked because the container's root filesystem is
`--read-only` and it runs `--cap-drop=ALL`, so nothing inside could create a user
later. The gateway assigns them and must never reuse one — a departed agent keeps
its uid so its leftovers can never become readable by whoever is created next.

Growing past 64 agents per organization means raising `SANDBOX_UID_POOL_SIZE`,
rebuilding the image, and raising the matching env var here. The service refuses
a uid outside the pool rather than handing back a confusing `docker exec` error.

Resource limits are derived from how many agents actually have a directory, not
sent by the client — clients don't get to set limits on a container they share.
A new agent triggers `docker update`, never a container recreate.

## The volume is the source of truth

Nothing syncs anywhere. There is no rclone, no S3, no staging directory, no
bidirectional reconciliation. Everything an agent does lives in the named volume
`hyros-workspace-<organizationId>`, and that volume outlives the container, this
service, and the host's page cache.

Three consequences, all of them good:

**Reaping and destroying are cheap.** Removing a container discards a cache, not
work. The TTL (4h by default) is a backstop against abandoned tenants, not a
deadline anyone races. `DELETE /sandboxes/:id` removes the container and keeps the
volume; only `?purgeVolume=1` deletes data.

**Restarts don't disturb anything.** Containers outlive this process by design, so
shutdown leaves them running and boot adopts whatever is still there (found by the
`ai.hyros.sandbox` label). An agent mid-task survives a deploy of the service in
front of it.

**The roster is read, not remembered.** Which agent owns which uid is recovered by
listing `/workspace` and reading each directory's owner. So a restarted service —
or a rebuilt container — knows the roster without any bookkeeping of its own, and
an agent whose directory exists can be exec'd into immediately.

Every route except the two lookups is self-healing: it starts or adopts the
organization's container if it is not up. The client never orchestrates a
reconnect.

One thing that is *not* durable: which image a container runs. It is read back off
a running container (so an adopted one keeps its own), but a container recreated
from scratch uses `SANDBOX_IMAGE`. That is correct while the platform ships one
sandbox image for everyone; per-tenant images would need the image recorded
somewhere the volume can answer for.

## One network per organization

Agents need the internet — installs, APIs, fetching a skill. They do not need each
other. So every organization gets its own user-defined bridge network,
`hyros-net-<organizationId>`, created with the container and removed with it:

- **Egress works.** A user-defined bridge NATs out like the default one.
- **Tenants cannot see each other.** Docker isolates separate bridges, so one
  organization's container cannot reach another's by IP. Agents inside the same
  organization share a network and can, which is fine — they are one trust domain.
- **Our own services stay out of reach.** Nothing lands on the default bridge.

Two consequences worth planning for:

**The metadata firewall rule is now required, not optional.** With egress on by
default, a sandbox can reach `169.254.169.254` and read cloud credentials unless
the host drops it. One rule in `DOCKER-USER` covers every organization network:

```bash
iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
```

**Docker's default address pool caps a host at about 31 networks.** Past that,
creation fails with "could not find an available, non-overlapping IPv4 address
pool". A host serving more organizations than that needs a wider pool in
`/etc/docker/daemon.json`:

```json
{ "default-address-pools": [{ "base": "10.200.0.0/16", "size": 24 }] }
```

That yields 256 networks of 254 addresses each. Restart the daemon after editing.

## Endpoints

Auth is a bearer token, `SANDBOX_SERVICE_TOKEN`. If the variable is unset, auth is
off; that is for local development only.

| Method   | Path                                    | Purpose                                                       |
| -------- | --------------------------------------- | ------------------------------------------------------------- |
| `GET`    | `/health`                               | Liveness                                                      |
| `POST`   | `/sandboxes`                            | Create or adopt. `201` created, `200` already running          |
| `GET`    | `/sandboxes/:orgId`                     | Registry lookup. `404` when this process has no entry          |
| `POST`   | `/sandboxes/:orgId/agents/:agentId`     | Give an agent its directory (idempotent, no recreate)          |
| `POST`   | `/sandboxes/:orgId/exec`                | Run a command as `agentId`                                     |
| `POST`   | `/sandboxes/:orgId/write-file`          | Write via stdin — no `ARG_MAX` limit                           |
| `POST`   | `/sandboxes/:orgId/read-file`           | Read a file, returned base64                                   |
| `DELETE` | `/sandboxes/:orgId`                     | Remove the container. `?purgeVolume=1` also deletes the volume |

`exec`, `write-file` and `read-file` all take an `agentId`. It picks the uid and
the working directory, and it is what the path jail is checked against: a path
resolving outside that agent's directory is rejected server-side, `..` included.
Reads may also reach `.shared`; writes never may.

An agent with no directory yet gets `409 AGENT_NOT_PROVISIONED` — call the agents
endpoint and retry.

### POST /sandboxes

```json
{
  "organizationId": "<organization uuid>",
  "image": "hyros-sandbox",
  "network": "none",
  "readOnly": true,
  "agents": [
    { "agentId": "<agent uuid>", "uid": 10000 },
    { "agentId": "<agent uuid>", "uid": 10001 }
  ]
}
```

`agents` is optional and idempotent: pass the whole roster to provision it in one
call, or leave it out and provision each agent on demand. Unlike the S3-mount
design this replaces, a late joiner never recreates the container, so adding one
is invisible to whatever the other agents are running.

## Configuration

| Variable                             | Default         | Meaning                                                             |
| ------------------------------------ | --------------- | ------------------------------------------------------------------- |
| `SANDBOX_SERVICE_PORT`               | `3100`          | Listen port                                                         |
| `SANDBOX_SERVICE_TOKEN`              | —               | Bearer token. Unset disables auth (dev only)                        |
| `SANDBOX_IMAGE`                      | `hyros-sandbox` | Image new containers run                                            |
| `SANDBOX_NETWORK`                    | per organization | Docker network. Unset means `hyros-net-<org>`, created on demand. A name here shares one network across tenants; `none` removes networking |
| `SANDBOX_TTL_MS`                     | `14400000`      | Idle window before a container is reaped (the volume survives)       |
| `SANDBOX_REAPER_INTERVAL_MS`         | `30000`         | Reaper check interval                                               |
| `SANDBOX_REQUEST_TIMEOUT_MS`         | `180000`        | Default per-command timeout, and the ceiling on a client-supplied one |
| `SANDBOX_MAX_CONCURRENT_PER_SANDBOX` | `3`             | In-flight requests per organization                                 |
| `SANDBOX_MAX_CONCURRENT`             | `24`            | In-flight requests across all organizations                         |
| `SANDBOX_MAX_QUEUED`                 | `64`            | Queue depth before `429`                                            |
| `SANDBOX_UID_BASE`                   | `10000`         | Must match the image's `SANDBOX_UID_BASE` build arg                 |
| `SANDBOX_UID_POOL_SIZE`              | `64`            | Must match the image's `SANDBOX_UID_POOL_SIZE` build arg            |

On the gateway side, two variables point at this service:

```bash
SANDBOX_SERVICE_URL=http://localhost:3100
SANDBOX_SERVICE_TOKEN=<same token>
```

## Running it

```bash
# build the image agents run in
docker compose --profile build-only build sandbox-image

# the service itself
docker compose up -d          # or: bun run dev  → http://localhost:3100
```

Bun runs the TypeScript directly, so there is no build step and no `dist` to keep
in sync.

### Deploy checklist

1. Docker daemon running, `docker` CLI available, socket mounted.
2. `hyros-sandbox` image built on that host.
3. `SANDBOX_SERVICE_TOKEN` set. Unset means no auth.
4. Block the cloud metadata endpoint — Docker cannot do this, the host must:

   ```bash
   iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
   ```

   Make it persistent, and verify from inside a sandbox that
   `curl -m 2 http://169.254.169.254/` times out.

Because workspaces are host-local volumes, an organization is pinned to the host
that holds its volume. With one sandbox host that is nothing; a fleet needs an
organization → host mapping in front of this service.

## Development

```bash
bun test        # pure layout/path-jail tests, no Docker needed
bun run typecheck
```

The Docker-touching paths were verified end to end against a real daemon: create,
adopt after a service restart, late join without recreate, cross-agent read
refused by the kernel, container destroyed and rebuilt with the roster and files
recovered from the volume, then purge.
