# Hyros AI — Agent OS Architecture (Locked-In Decisions)

> This document captures the decisions locked in during the architecture grilling session.
> It is the source of truth for the product vision and technical direction.
> Open/deferred items are explicitly marked.

---

## 1. Product Vision

**Hyros AI is an all-in-one AI platform — an "agent OS"** (in the spirit of co-work / openclaw, but simpler and easier to use).

- Powered by **Mastra AI** + a **workspace** model.
- Agents run in a **cloud sandbox** so they **keep working** even when the user's laptop is closed.
- Users delegate work to agents; agents execute long-running tasks, use browser tools, and integrate with external apps.
- Agents have **personality (SOUL)**, can be **dynamically created at runtime**, and can be given **skills**.

---

## 2. Multi-Tenancy (Workspace Model)

Standard multi-tenant architecture (like Notion / Slack) — **not** an agent concept.

- A **User** has memberships to one or more **Workspace** tenants.
- **Individual workspace** = single-member tenant. Auto-provisioned at signup.
- **Team workspace** = multi-member tenant with roles.
- A user can belong to multiple team workspaces **and** have their own individual workspace simultaneously.

> **Open:** Team workspace roles & permissions (Owner/Admin/Member/Viewer) — not yet decided.

---

## 3. High-Level Architecture

**Hybrid: Elysia control plane + Mastra agent runtime, mounted in-process.**

```
Elysia (control plane: auth, tenancy, integrations, billing)
  └─ .mount("/mastra", mastraHonoApp.fetch)   ← Mastra agent runtime
        └─ agents, workflows, signals, schedules, sandbox
```

- **Elysia** = platform/control plane (auth, tenancy, integrations, billing).
- **Mastra** = agent runtime plane (durable agents, sandboxes, signals, schedules).
- The two communicate over an internal contract; Elysia routes call Mastra's agent controller, and agent events stream back through Elysia to the client.

### Verified: Mastra has NO Elysia adapter

- Mastra server adapters: **Hono (`@mastra/hono`), Express (`@mastra/express`), Fastify (`@mastra/fastify`), Koa (`@mastra/koa`), NestJS (`@mastra/nestjs`)**. **No Elysia.**
- Mastra's `@mastra/deployer` server is Hono-based (`createHonoServer` / `createNodeServer`).
- **Workaround:** Elysia's `.mount()` can embed any web-standard `Request → Response` handler. Hono apps expose `.fetch` as exactly that, so Mastra's Hono server is mounted under a prefix in Elysia.

### Mounting seam: **in-process mount**

- One Bun process, one port, zero network hop.
- Mastra and Elysia share the process; Elysia's tenancy middleware wraps all routes including Mastra's.

---

## 4. Auth & Data

- **Auth:** Supabase (auth + SSO). Google OAuth for signup.
- **Database:** Drizzle ORM + Postgres.
  - Postgres instance: **local for now, cloud later** (deferred, not an issue).
  - Mastra storage/memory moves from the current `file:./mastra.db` LibSQL to `@mastra/pg` on the same Postgres.
  - Drizzle owns the schema.

---

## 5. Agent Runtime (Mastra)

### Durable agents (the "keeps working" engine)

Mastra durable agents solve realtime + background execution natively:

- **PubSub streaming** — events flow through PubSub keyed by `runId`; clients can disconnect/reconnect without missing chunks.
- **AI SDK SSE out of the box** — standard SSE protocol; the desktop app consumes it with the AI SDK.
- **Resumable streams** — `observe(runId)` lets a different client pick up a stream another started.
- **`createEventedAgent()`** — fire-and-forget background execution; the workflow runs in the background, chunks consumed via PubSub.
- **Tool approval (human-in-the-loop)** — `requireToolApproval: true` suspends the workflow, emits `onSuspended`, resumes with `resume(runId, { approved })`.
- **Crash recovery** — `recovery.durableAgents: 'auto'` re-drives orphaned runs on boot (with Postgres storage).
- **`createInngestAgent()`** — production path with step memoization, retries, monitoring.

> **Open:** Durable agent variant — both `createDurableAgent()` (in-process, awaited) and `createEventedAgent()` (background, fire-and-forget) are valid paths, chosen per use-case.

### Dynamic agents

- **`AgentController`** — session controller with **dynamic modes** (switchable at runtime). Each mode has its own `id`, `name`, `defaultModelId`, `instructions`, `availableTools`, `transitionsTo`.
- **`Mastra.addAgent()`** — agents registered at runtime, not just startup.
- **`@mastra/editor`** — stores, versions, and instantiates complete agent configs from a database (instructions, model, tools, workflows, nested agents, memory). CRUD + version management + dependency resolution.

### SOUL, Modes, Subagents

- **SOUL** = per-agent personality/identity. The agent picks a personality; the user can ask the agent to change it.
- **SOUL and modes are independent** — each contributes its own `instructions` block, combined as **sections in the system prompt**:

```
[Base agent instructions]  ← from Agent.instructions
[SOUL section]             ← the agent's identity/personality (per-agent, user-editable)
[Mode section]             ← the current working mode's instructions (plan/build/fast)
[Subagent definitions]     ← focused agents with narrower toolset + own model
```

- **Subagents** are first-class: each has `id`, `name`, `description`, `instructions`, `allowedWorkspaceTools` (per-subagent tool allowlist), `defaultModelId`, `maxSteps`. The parent agent delegates to them for focused tasks.
- The whole thing (SOUL, modes, subagents, tools, models) is a **DB row** the user can edit from the desktop app.

### Model provider

- **Provider-agnostic** via Mastra's magic-string model config (`openai/*`, `anthropic/*`, etc.).
- Default to a capable-but-cheap model; allow **per-agent model override**.

---

## 6. Sandbox & Browser-Use (ego-lite)

- **One sandbox per workspace** (per-tenant isolation boundary).
- **ego-lite** (`citrolabs/ego-lite`) is the sandbox browser — a Chromium browser used by **both users and agents** in parallel, sharing login state.
- **1:1 mapping:** one ego-lite **Task Space** per Hyros workspace.
- **Runs in the cloud** — the desktop app is the control surface; the heavy browser runs in the cloud so agents keep working when the laptop is closed.
- **Persistent browser profile** per workspace sandbox — logins/cookies survive between tasks.
- ego-lite features: `useOrCreateTaskSpace`, `listTaskSpaces`, `completeTaskSpace`, and a **control handoff protocol** (`handOffTaskSpace` / `takeOverTaskSpace` / `waitForAgentControl`) for CAPTCHA/manual-login interventions.

---

## 7. Integrations (Nango)

- **Nango** handles OAuth + token storage and provides **executable tools** the agent can call.
- **Workspace-level connections** — a connection (e.g. "this workspace's Gmail") is owned by the workspace, available to all agents in it.
- **Per-agent tool access control** — each agent has an allowlist of which tools it can invoke.
- Nango (API integrations) and ego-lite (web interactions) are complementary; agents can use both.

---

## 8. Skills

- **Custom skills** (we ship) + a **library/marketplace** + **user-created skills** (the agent builds them for the user).
- Skills are first-class, versioned, attachable to agents.
- Mastra supports all of this.

---

## 9. Clients

- **Desktop app (Tauri) is the only client for now.** Web and CLI are ignored for now.
- The desktop app is a **minimal cloud client** — a control panel + agent chat over the cloud gateway.
- **No local filesystem bridge** (skipped — the agent runs in the cloud; local FS access was considered and dropped).

### Tauri (TS + Rust)

- **Not purely Rust.** Two layers:
  - **Frontend (TypeScript/React)** — the UI, running in the OS webview.
  - **Backend (Rust)** — native operations (file system, keychain, processes) via `#[tauri::command]` functions.
- TS calls Rust via `invoke()`; Rust returns results to TS.
- Native needs: secure token storage (keychain), file picker (dialog plugin), opening URLs (shell plugin), streaming (events/channels).

---

## 10. Realtime Streaming

- **Solved natively by Mastra durable agents** — no custom WebSocket layer.
- Desktop app consumes agent output via **AI SDK SSE**.
- PubSub + Postgres-persisted run state handle resumption and background execution.
- Elysia stays the auth/tenancy gate and exposes the SSE stream.

---

## 11. Deferred / Open Decisions

- **Deployment & infrastructure** — not a concern now; decide later.
- **MVP scope** — skipped; build it all, including settings.
- **Team workspace roles & permissions** — not yet decided.
- **Durable agent variant** (A vs B) — both valid, per use-case.
- **Postgres hosting** — local for now, cloud later.
- **Gateway distribution model** — self-hosted/on-prem vs. hosted-only (from original architecture.md).
- **Web/Website framework** — deferred (web client ignored for now).
- **Mobile UI sharing depth** — deferred (mobile not in scope now).

---

## 12. Current Codebase Gaps (to reconcile)

> **Status:** the gateway is now a clean control plane — `GET /health` plus the
> in-process Mastra mount at `/mastra` (no demo routes, no static tools). The
> only outstanding item is storage.

- ✅ **(resolved)** `mastra/index.ts` previously claimed Elysia routes call the
  agent, but `apps/gateway/src/index.ts` had **zero** Mastra references — the
  agent was orphaned. **Now:** `index.ts` mounts the Mastra Hono app at `/mastra`
  (`apps/gateway/src/mastra/server.ts` → `MastraServer.init()` → `.fetch`).
- ✅ **(resolved)** Duplicate demo user data in `apps/gateway/src/index.ts` and
  `apps/gateway/src/mastra/tools/get-user-info.ts`. **Now:** both the static
  `get-user-info` tool and the `data/users` demo module were removed — the
  gateway no longer carries placeholder data. The real data layer will be Drizzle
  + Postgres (§4).
- ⏳ **(deferred)** Current `file:./mastra.db` LibSQL storage must move to
  `@mastra/pg` on the same Postgres (§4 — Postgres hosting is local-for-now,
  cloud later).
- ✅ **(resolved)** The `support-agent` + `getUserInfoTool` placeholders were
  turned into a clean mount smoke test: `GET /mastra/api/agents` returns the
  agent config through Elysia. The agent is now a minimal, tool-less default
  agent. The "real DB" half waits on the storage item above.