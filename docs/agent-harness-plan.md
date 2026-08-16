# Agent Harness — Implementation Plan (pickup doc for next session)

Status: **Milestone DONE (TASK-021..026). Desktop wired and building; `/chat` + events + agents + history live and E2E-verified.**

> **Desktop implementation (TASK-025/026)** — the user's three directives landed:
> 1. Model inlined in code (`src/lib/model.ts` `HYROS_MODEL`); no `MASTRA_MODEL` env. Current model: `openrouter/poolside/laguna-s-2.1:free`; Mastra reads `OPENROUTER_API_KEY` from env.
> 2. `POST /chat` = fire-and-forget **200-empty**; `isNew` requires client-generated **uuid** `agentId` (idempotent).
> 3. Clients subscribe via `GET /chat/:agentId/events` (SSE) → shared zustand store `createChatStore` in `@hyros-ai/client-runtime`.
>
> Gateway additions: `GET /agents` (chat list w/ last message, raw SQL + timezone fix for Mastra's naive-UTC `createdAt`), `GET /chat/:agentId/messages` (history/reattach), guard accepts `?token=` for EventSource. Shared UI retyped to agent-shaped `Chat` (string uuid ids, DiceBear avatar urls, `pendingQuestion`, `running`) + "+" button. Desktop: `src/lib/chat.ts` container (store module-singleton + EventSource bridge + Bearer headers), token tracking in `auth.ts`; web left as empty-state placeholder for later. `vite build` clean.

> Rework note: the first TASK-023 implementation was reverted after a two-axis
> review (backup tag `backup/task-023-reverted`). The runtime is now
> request-driven in `apps/gateway/src/chat/` (`runtime.ts`, `tools.ts`,
> `routes.ts`) — NOT in `src/mastra/`. Controllers are built lazily per agent
> row and are **standalone** (verified in 1.59 source: `runInit()` builds an
> internal Mastra around `config.storage` when unregistered — registration only
> powers `/mastra/api/*` routes, which dynamic agents don't use); they share the
> gateway's PostgresStore via `mastra.getStorage()`. Review fixes applied:
> strict `resourceId === ownerId` re-park (no `unknown` fallback), single
> `fillTemplate`, no reliance on `@internal __registerMastra`.
This file is the handoff: current state, verified findings, decisions, and the
exact next steps. The authoritative API surface is the installed `.d.ts` files
— Mastra docs lag the code (proven repeatedly); never trust docs alone.

---

## 1. Current state (end of last session)

| Item                 | State                                                                                                                                                                                                                                                                   |
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `@mastra/*` packages | Upgraded to latest stable: core **1.59.0**, hono 1.6.1, libsql 1.20.0, memory 1.26.2, loggers 1.2.0, evals 1.7.0, observability 1.17.0. `bun run typecheck` clean in gateway.                                                                                           |
| Model                | `openrouter/poolside/laguna-s-2.1:free`; `OPENROUTER_API_KEY` in root `.env`.                                                                                                                                                                                           |
| Spike script         | `apps/gateway/scripts/spike-controller.ts` — 4 modes, all PASS (keep as regression check).                                                                                                                                                                              |
| Drizzle migration    | `0001` applied to **prod Postgres**: `agents` table EXISTS (pkey + `agents_owner_id_idx`).                                                                                                                                                                              |
| Drizzle journal fix  | Prod had 0000's tables/enum pre-existing but **no journal row** → `drizzle-kit migrate` errored on `CREATE TYPE`. Fixed by inserting journal row `('0000_gigantic_pete_wisdom', 1785769736159)` into `drizzle.__drizzle_migrations` then running the migrator directly. |
| Gateway storage      | **SWAPPED to `PostgresStore`** (apps/gateway/src/mastra/index.ts + spike script). Verified: typecheck clean, gateway boots (`/health` OK, `/mastra/api/agents` lists supportAgent), **37 `mastra_*` tables auto-created in `public`** (pg-verified). Spike regression vs Postgres **PENDING** — cline-pass HTTP 429 quota (`INFERENCE_CAP_ERROR`, 5h limit, reset ~13:55Z Aug 15) hit mid-run; rerun both modes after reset. |
| Tasks                | TASK-021/022/023/024 done. TASK-025 remaining: `GET /agents` (chat list + last message). TASK-026: web wiring. Dev auth: env-gated `DEV_USER_ID` escape in guard.ts (uuid). |

### Client/server contract (locked, user directives)
- **Model is inlined** — `src/lib/model.ts` exports `HYROS_MODEL = "openrouter/poolside/laguna-s-2.1:free"`; no `MASTRA_MODEL` env. Only `OPENROUTER_API_KEY` is secret/configurable.
- **POST /chat = fire-and-forget** — 200, empty body. `isNew` requires a **client-generated uuid** `agentId` (idempotent via `onConflictDoNothing`).
- **GET /chat/:agentId/events = the subscription channel** — SSE: `session`, `snapshot` (displayState), live `message`/`ask_user`/`done`/`error`, 25s heartbeat.
- **Client state** — `createChatStore` (zustand vanilla) in `@hyros-ai/client-runtime`: `attach/detach/send/createAgent`; EventSource injected (browser global on web/desktop, polyfill on mobile); auth headers injectable (SSE header limit noted for prod). Live smoke: `packages/client-runtime/src/chat-store.smoke.ts`.

## 2. Spike verdict (verified on 1.59.0)

1. **ask_user round-trip** ✅ — approval gate first, then suspend:
   - agent calls `ask_user` → event `tool_approval_required` → respond
     `session.respondToToolApproval({ decision: 'approve' })`
   - tool runs → event `tool_suspended` with `suspendPayload: { question }`
   - answer via `session.respondToToolSuspension({ toolCallId, resumeData: "Ada" })`
   - answer reaches the tool's output (`"User answered: Ada"`), agent continues.
2. **Memory required for persistence** ✅ — without `memory: new Memory()` on the
   controller, threads/messages do NOT persist (DB empty). With it: user msg
   stored as `type=signal`, assistant as `format:2` parts JSON incl. reasoning
   + tool-invocation, with `metadata.modelId/provider`.
3. **Crash recovery** ✅ — THE bulletproof mechanism:
   - Parked-suspension registry (`session.suspensions`) is **in-memory only**,
     NOT rehydrated after restart.
   - The suspended **run survives** in storage. `controller.getCurrentAgent(session)`
     → `agent.listSuspendedRuns()` returns `{ runs: [{ runId, threadId, resourceId,
     suspendedAt, toolCalls: [{ toolCallId, toolName, suspendPayload }] }] }`.
   - Recovery: re-park then resume natively —
     ```ts
     session.suspensions.register({ toolCallId, runId, toolName });
     await session.respondToToolSuspension({ toolCallId, resumeData });
     ```
   - ⚠️ Raw `agent.resumeStream()` FAILS after restart — resumed run loses
     controller-injected tools (ask_user not found). Always resume via session.
4. **DurableAgent compat** ✅ — `createDurableAgent({ agent })` works as the
   controller's backing agent (cast `as unknown as Agent` at the constructor).

## 3. API reality vs docs (all verified in node_modules .d.ts)

- Controllers register **on** Mastra: `new Mastra({ agents, agentControllers: { [id]: controller }, storage })` — Mastra injects itself.
- Everything lives on **Session** (`controller.session` or from `createSession`):
  `subscribe`, `sendMessage`, `steer`, `followUp`, `respondToToolSuspension`,
  `respondToToolApproval`, `suspensions` (`register/get/has/delete/hasPending/resolveToolCallId`),
  `thread` (`list/getById/set/create/listMessages`), `state` (schema-validated), `displayState.get()`.
- `createSession({ id, ownerId, resourceId?, threadId? })` **auto-binds** the most
  recent thread for the resource (or creates one). `threadId` binds/creates exact.
- Sessions **throw without a `workspace`** — controller-level `workspace` required.
- Controller supports `browser` + `subagents` + `modes` (per-mode agent/tools/
  instructions overrides) — all available later, nothing to retrofit.
- **Model string quirk**: `cline-pass/cline-pass/deepseek-v4-flash` (3 segments)
  is correct — the cline-pass endpoint wants `modelType/model` in the modelId,
  so provider=`cline-pass`, modelId=`cline-pass/deepseek-v4-flash`.
  `cline-pass/deepseek-v4-flash` (2 segments) → HTTP 400 "invalid model format".

## 4. Locked design decisions

- **agents table = identity/persona source of truth.** `name` NOT NULL
  (insert `'New agent'`), `description`/`avatar_url` nullable, `owner_id` FK→users
  cascade, `agents_owner_id_idx`.
- **Dynamic instructions** `instructions = f(DB row)`: no description → spawn
  instructions ("you just spawned; interview your creator via ask_user, then call
  update_profile"); has description → persona. Keeps "who am I" in one place.
  Modes exist if we later want plan/build personalities — not needed now.
- **Thread mapping**: `resourceId = ownerId` (user), `threadId = agentId`
  (one conversation per user↔agent). Chat list = agents rows + last message.
- **Workspaces**: per-agent `new Workspace({ filesystem: LocalFilesystem({ basePath: ./workspaces/<agentId> }) })`
  at controller config. (Sandbox/browser/web-nav attach later — controller
  already has `browser` + workspace slots.)
- **Permissions**: set controller-level policy `allow` for `ask_user` (onboarding
  UX shouldn't prompt approve), `ask` for workspace `execute_command` etc. —
  grants/policies are per-session in-memory → re-assert on every boot.
- **ask_user resume glue (server-side)**: message-send handler checks the
  session for a pending (or re-parked) suspension → `respondToToolSuspension`
  with the message text as `resumeData`; else `sendMessage`/`steer`.
- **Avatar**: store `avatar_url` if/when user picks a seed; render fallback
  `https://api.dicebear.com/9.x/clay/svg?seed=<agentId>`.

## 5. Tasks left (TICK board)

- **TASK-022 (code-complete, spike re-run pending)** — storage swapped to
  Postgres in gateway + spike. API corrections vs the plan above (verified
  against installed `@mastra/pg` 1.20.0 .d.ts — plan snippet was wrong):
  - `ssl` is `boolean | ConnectionOptions` (pg types) — no `"require"` string
    (that's postgres.js). pg equivalent of postgres.js `ssl:"require"` =
    `{ rejectUnauthorized: false }` (enforce TLS, skip chain verify).
  - `prepare` is postgres.js-only; pg never auto-prepares — option dropped.
  - Table creation is **lazy per-domain**: `ensureDomainReady()` →
    `initStorage()` on first storage op (or `mastra.startWorkers()`), NOT on
    bare `new Mastra()` boot. First op created **37 `mastra_*` tables** in
    `public` (verified via information_schema).
  Remaining: spike full + suspend-exit→resume cycle vs Postgres — blocked by
  cline-pass 429 quota at time of swap; rerun and only then close the task.
- **TASK-023** — runtime factory: DB row → Agent (dynamic instructions) →
  AgentController (memory, workspace, permission policy) → register on the
  gateway's Mastra `agentControllers`. Boot sync from DB. **Crash recovery
  loop**: on boot, for each agent `listSuspendedRuns()` → re-park → resume glue.
- **TASK-024** — `update_profile` tool (name/description/avatar seed → own row;
  the "onboarding complete" moment that flips instructions to persona).
- **TASK-025** — gateway API (auth-guarded):
  - `POST /agents` — insert row, build controller, kickoff spawn run, return agentId
  - `GET /agents` — user's agents + last message (chat list)
  - `POST /agents/:id/messages` — pending suspension → resumeData, else sendMessage/steer
  - `GET /agents/:id/events` — SSE: `display_state_changed` + `message_update` snapshots
  - Auth note: web has no Supabase auth yet (MOCK_USER). Options: land web auth
    first, or an env-gated dev identity (server-side `DEV_USER_ID`, off in prod).
    Decision needed — do not weaken the guard.
- **TASK-026** — web/UI wiring: plus button → create flow; chat list re-typed to
  string agent ids (current `Chat` uses numeric `id`/`senderId` + mock data);
  render SSE events (message content is parts-JSON `format:2`); ask_user inline.

## 6. Gotchas / open questions for next session

1. Whether `approval grants` survive process restart (docs say no; re-assert policies each boot either way).
2. Chat-list "last message": query `mastra_messages` by threadId per agent (storage
   `listMessages`) vs denormalizing `last_message` onto agents row — decide during TASK-025.
3. ~~Confirm `PostgresStore.init()` auto-creates `mastra_*` tables~~ ANSWERED:
   yes — 37 tables in `public`, created lazily on first storage op (not bare
   boot). Done.
4. Keep the spike script green as the regression check for every subsequent task.
