---
project: hyros-ai
schema_version: "1.0"
created: Mon Aug 03 2026 20:25:27 GMT+0100 (Central European Standard Time)
updated: 2026-08-15T15:18:26.754Z
default_workflow: [backlog, todo, in_progress, review, done]
id_prefix: TASK
next_id: 27
---

## Agents

| Agent | Type | Role | Status | Working On | Last Active | Trust Level |
|-------|------|------|--------|------------|-------------|-------------|
| @cline | bot | engineer, auth, backend, frontend | idle | - | 2026-08-15T15:18:26.754Z | trusted |

---

## Tasks

### TASK-001 · Implement Supabase auth with Google Sign-In (login/logout)

```yaml
id: TASK-001
status: backlog
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:45:16.728Z
updated_at: 2026-08-07T22:19:27.531Z
tags:
  - auth
  - epic
history:
  - ts: 2026-08-03T19:45:16.728Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-07T22:19:27.531Z
    who: "@cline"
    action: commented
    note: "Dev-mode E2E verified working (system browser → Supabase → gateway bridge
      → PKCE exchange → real macOS Keychain → /auth/session → UI shows user)
      after TASK-008 bridge + TASK-009 keyring fix. Remaining before closing
      epic: prod bundle verification tracked in TASK-010; optional
      standardization in TASK-011."
```

> Epic: add real authentication to Hyros AI. Scope is deliberately minimal — a user can sign in with Google and sign out, on both the gateway (Elysia) and the desktop client (Tauri). Source of truth: agent-os-architecture.md §4 (Auth: Supabase + SSO, Google OAuth) and §9 (Tauri is the only client). This epic tracks the full vertical slice; subtasks below implement it.

### TASK-002 · Configure Supabase project + Google OAuth env & client config

```yaml
id: TASK-002
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:45:26.823Z
updated_at: 2026-08-04T11:36:50.289Z
tags:
  - auth
  - config
  - backend
history:
  - ts: 2026-08-03T19:45:26.823Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-03T20:54:11.469Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-03T21:01:22.670Z
    who: "@cline"
    action: commented
    note: "Code scaffolding complete and type-clean. (1)
      @supabase/supabase-js@2.112.0 added to gateway + desktop. (2) Gateway
      server client apps/gateway/src/lib/supabase.ts (service-role,
      persistSession:false). (3) Desktop browser client
      apps/desktop/src/lib/supabase.ts (anon, PKCE). (4) Env templates: root
      .env.example (SUPABASE_URL/SERVICE_ROLE_KEY) + apps/desktop/.env.example
      (VITE_SUPABASE_URL/ANON_KEY) + apps/desktop/src/vite-env.d.ts typing. (5)
      Runbook docs/auth-supabase-setup.md. Design: two separate clients (server
      secret vs browser anon) so the service-role key never ships to the
      desktop. Awaiting operator to complete the Supabase dashboard setup per
      the runbook and paste keys into .env. Note: desktop tsc has a PRE-EXISTING
      unrelated error in App.tsx (api.users route missing) - not from this
      task."
  - ts: 2026-08-04T09:08:47.788Z
    who: "@cline"
    action: commented
    note: "Progress update: (1) DATABASE_URL now points to Supabase pooler
      (aws-1-eu-west-2.pooler.supabase.com:5432, session mode IPv4) — direct
      connection is IPv6-only on free tier so pooler is required. (2) DB client
      + drizzle-kit auto-detect SSL (ssl:require for remote, false for local) +
      prepare:false for pooler compat. (3) Drizzle schema pushed to Supabase —
      users, organizations, organization_memberships tables + organization_type
      enum all live. (4) Real DB password moved from .env.example (was
      git-tracked!) to .env (gitignored). (5) SUPABASE_URL + VITE_SUPABASE_URL
      pre-filled from project ref. REMAINING: operator needs to paste
      SUPABASE_SERVICE_ROLE_KEY (root .env) and VITE_SUPABASE_ANON_KEY
      (apps/desktop/.env) from Supabase dashboard → Settings → API. Once both
      keys are in, TASK-002 is done and TASK-003/TASK-004 unblock."
  - ts: 2026-08-04T11:36:50.289Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

> Foundation task for both backend & desktop tracks. Deliverables: (1) Add Supabase env vars to .env.example and the gateway — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server/verify) and the anon key for the desktop client. (2) Add @supabase/supabase-js dependency to gateway + desktop. (3) Create a shared Supabase client config module. (4) Document the manual one-time steps the operator must do in the Supabase dashboard (create project, enable Google OAuth provider, configure redirect URIs incl. the Tauri custom-protocol deep link, set the JWT secret). No app behavior changes yet — this unblocks TASK-003 and TASK-004. Per agent-os-architecture.md §4.

### TASK-003 · Gateway: Supabase JWT auth middleware on Elysia

```yaml
id: TASK-003
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:45:47.895Z
updated_at: 2026-08-04T11:53:10.937Z
tags:
  - auth
  - backend
  - gateway
depends_on:
  - TASK-002
history:
  - ts: 2026-08-03T19:45:47.895Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-04T11:45:28.966Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-04T11:52:34.171Z
    who: "@cline"
    action: commented
    note: "TDD red-green complete. authGuard: Elysia plugin with derive (extract
      Bearer, verify via supabase.auth.getUser, map to AuthUser) + guard (401 if
      no user). 3 tests via bun:test mocking lib/supabase.ts: (1) no header ->
      401, (2) invalid token -> 401, (3) valid token -> 200 + mapped user.
      Opt-in via .use(authGuard) — /health and /mastra stay public. One any cast
      on guard beforeHandle (Elysia TS inference gap: derive->guard context not
      chained, ponytail comment explains). Skipped: no requireAuth macro, no
      global middleware, no exemptions list, no new deps."
  - ts: 2026-08-04T11:53:10.937Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

> Add an Elysia guard/derive middleware that verifies the Supabase access token (Bearer header) and attaches the authenticated user (id, email, name, avatar) to the request context. Use the Supabase service-role client (supabase.auth.getUser(token)) or local JWT verification via the Supabase JWKS/jwt secret. Return 401 on missing/invalid token. Exempt public routes (/health, /mastra read-only smoke). This is the auth gate that all protected routes depend on. Per agent-os-architecture.md §3 (Elysia = control plane incl. auth) and §4.

### TASK-004 · Desktop: Supabase client + Google OAuth flow for Tauri

```yaml
id: TASK-004
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.188Z
updated_at: 2026-08-04T15:34:26.103Z
tags:
  - auth
  - frontend
  - desktop
  - tauri
depends_on:
  - TASK-002
history:
  - ts: 2026-08-03T19:46:41.188Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-04T15:34:26.103Z
    who: "@cline"
    action: completed
    from: backlog
    to: done
```

> Client-side Google sign-in that works inside a Tauri v2 webview. Use supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo:'hyros://auth/callback' (Tauri deep-link custom protocol), flowType:'pkce' } }) opened in the system browser via the shell plugin; on the deep-link callback, exchangeCodeForSession to obtain a Supabase session. Persist the session securely (Tauri secure-storage / keychain via a Rust #[tauri::command], NOT plain localStorage). Output: a Supabase session whose access_token (JWT) the desktop app can send to the gateway. Per agent-os-architecture.md §9 (native needs: keychain token storage, shell plugin to open URLs, deep-link for callbacks).

### TASK-005 · Gateway: upsert user profile from Supabase on auth

```yaml
id: TASK-005
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.447Z
updated_at: 2026-08-04T15:25:40.005Z
tags:
  - auth
  - backend
  - db
depends_on:
  - TASK-003
history:
  - ts: 2026-08-03T19:46:41.447Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-04T15:19:34.294Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-04T15:25:10.157Z
    who: "@cline"
    action: commented
    note: "TDD red-green complete. auth/service.ts: upsertUser(authUser) — single
      Drizzle upsert on users table (id=email=name=avatarUrl on insert;
      email/name/avatarUrl+updatedAt on conflict). 2 tests mock lib/db.ts with
      chainable insert().values().onConflictDoUpdate(): (1) verifies insert
      values match AuthUser, (2) verifies conflict set fields + updatedAt is a
      Date. Skipped: org auto-provisioning (task says optional/follow-up; schema
      is ready when needed). Typecheck clean, zero any."
  - ts: 2026-08-04T15:25:40.005Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

> Bridge Supabase auth to the Drizzle app schema. On an authenticated request, ensure a row exists in packages/db users table (id = Supabase auth user id; upsert cached email/name/avatarUrl from the verified token). This is what makes the app actually know who the user is (the users table is the app-level profile keyed by the Supabase auth uid per schema.ts). Optionally auto-provision the individual organization + organization_memberships row at first login per arch §2 (kept as a follow-up if out of minimal scope). Re-export the typed db client to the gateway. Per agent-os-architecture.md §4 and schema.ts.

### TASK-006 · Gateway: protected /auth/session (me) endpoint

```yaml
id: TASK-006
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.683Z
updated_at: 2026-08-04T15:37:28.079Z
tags:
  - auth
  - backend
  - gateway
depends_on:
  - TASK-005
history:
  - ts: 2026-08-03T19:46:41.683Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-04T15:26:49.503Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-04T15:37:28.079Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

> Add a protected GET endpoint (e.g. /auth/session or /me) guarded by the TASK-003 middleware that returns the current authenticated user (Supabase identity + the Drizzle app profile). This is what the desktop app calls after restoring a session to confirm it is still valid and to load the user object. Return 401 when unauthenticated. Per agent-os-architecture.md §3 (Elysia = auth gate exposing identity to clients).

### TASK-007 · Desktop: login/logout UI + session state management

```yaml
id: TASK-007
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.919Z
updated_at: 2026-08-04T16:01:02.346Z
tags:
  - auth
  - frontend
  - desktop
depends_on:
  - TASK-004
history:
  - ts: 2026-08-03T19:46:41.919Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-04T15:40:50.002Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-04T16:01:02.346Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

> Build the user-facing auth surface in the Tauri React app. Login screen with a Sign in with Google button (wires to the TASK-004 OAuth flow); logged-in view showing user email/name/avatar + a Sign out button (supabase.auth.signOut); session restored from secure storage on app start and validated via the gateway /auth/session endpoint; route the app between logged-out and logged-in states. No other features — just login/logout. Per agent-os-architecture.md §9 (desktop app is a minimal cloud client).

### TASK-008 · Fix dev-mode login: gateway OAuth bridge for tauri dev (macOS deep-link limitation)

```yaml
id: TASK-008
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-06T22:22:54.032Z
updated_at: 2026-08-06T22:23:42.898Z
tags:
  - auth
  - gateway
  - desktop
  - devex
history:
  - ts: 2026-08-06T22:22:54.032Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-06T22:23:42.000Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-06T22:23:42.227Z
    who: "@cline"
    action: commented
    note: "Root cause: macOS only routes custom URL schemes to bundled .apps, so the
      hyros://auth/callback deep link never reaches a bare tauri dev binary (and
      the built Hyros AI.app intercepts it instead). Google also blocks sign-in
      inside embedded webviews, so OAuth must stay in the system browser."
  - ts: 2026-08-06T22:23:42.449Z
    who: "@cline"
    action: commented
    note: "Fix: added dev-mode OAuth path. Desktop (import.meta.env.DEV) redirects
      browser to http://localhost:3000/auth/oauth/callback/<pollId>; new gateway
      oauth-bridge.ts holds the one-time code (single-use, 5-min TTL) and the
      app polls /auth/oauth/poll/<pollId>, then does the same PKCE exchange +
      keychain save. Added @elysiajs/cors (also fixes a latent CORS gap for
      /auth/session from the webview). Prod deep-link flow untouched. Verified:
      17 gateway tests pass, both typechecks clean, curl-tested
      callback/poll/preflight."
  - ts: 2026-08-06T22:23:42.669Z
    who: "@cline"
    action: commented
    note: "One-time setup needed: add http://localhost:3000/auth/oauth/callback/* to
      Supabase Redirect URLs (docs/auth-supabase-setup.md updated)."
  - ts: 2026-08-06T22:23:42.898Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-009 · Fix keyring silent mock fallback breaking dev sign-in + add auth observability

```yaml
id: TASK-009
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-07T22:19:04.109Z
updated_at: 2026-08-07T22:19:27.308Z
tags:
  - auth
  - desktop
  - gateway
  - bugfix
history:
  - ts: 2026-08-07T22:19:04.109Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-07T22:19:26.389Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-07T22:19:26.626Z
    who: "@cline"
    action: commented
    note: "Observability first: added leveled logger (lib/logger.ts, LOG_LEVEL env,
      silent under bun test) + per-request http-logger plugin to the gateway;
      instrumented oauth-bridge (callback stored / code delivered / supabase
      error params), auth guard (401s, token rejections), and server startup.
      Desktop: step-by-step [auth]/[app] console checkpoints in auth.ts +
      App.tsx with a 20s withTimeout around exchange and keychain steps so
      silent hangs surface as UI errors."
  - ts: 2026-08-07T22:19:26.849Z
    who: "@cline"
    action: commented
    note: 'Root cause found via logs: exchange succeeded and save_session returned
      Ok, but get_session immediately returned NoEntry. keyring v3 ships NO
      default store features — plain keyring="3" silently falls back to an
      in-memory MOCK on macOS (lib.rs cfg: not(apple-native) => mock). Mock
      set_password on one Entry instance does not round-trip to get_password on
      a fresh instance, so sessions vanished and sign-in silently failed.'
  - ts: 2026-08-07T22:19:27.085Z
    who: "@cline"
    action: commented
    note: 'Fix: keyring = { version="3",
      features=["apple-native","windows-native","sync-secret-service"] } in
      src-tauri/Cargo.toml (+comment). Added
      keychain_round_trip_across_entry_instances regression test in lib.rs —
      fails on the mock store, passes on the real Keychain. Validated: cargo
      check + cargo test pass, 17 gateway tests pass, both typechecks clean,
      gateway log smoke test via curl, and user-verified E2E Google sign-in in
      tauri dev.'
  - ts: 2026-08-07T22:19:27.308Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-010 · Verify Google OAuth in production bundle (hyros:// deep-link flow)

```yaml
id: TASK-010
status: backlog
priority: medium
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-07T22:19:04.310Z
updated_at: 2026-08-07T22:19:04.310Z
tags:
  - auth
  - desktop
  - prod
history:
  - ts: 2026-08-07T22:19:04.310Z
    who: "@amjed-bouhouch"
    action: created
```

### TASK-011 · Evaluate standardizing on tauri-plugin-oauth for dev+prod (replaces gateway bridge + deep link)

```yaml
id: TASK-011
status: backlog
priority: low
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-07T22:19:04.512Z
updated_at: 2026-08-07T22:19:04.512Z
tags:
  - auth
  - desktop
  - architecture
history:
  - ts: 2026-08-07T22:19:04.512Z
    who: "@amjed-bouhouch"
    action: created
```

### TASK-012 · Adopt shared client-runtime + platform-layer architecture (web/desktop/mobile anti-duplication)

```yaml
id: TASK-012
status: in_progress
priority: high
assigned_to: "@cline"
claimed_by: "@cline"
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T10:27:00.971Z
updated_at: 2026-08-09T10:29:00.851Z
tags:
  - architecture
  - monorepo
  - refactor
history:
  - ts: 2026-08-09T10:27:00.971Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-09T10:27:17.884Z
    who: "@cline"
    action: commented
    note: "Decision from t3code exploration: introduce client-runtime +
      platform-layer DI seam so web/desktop/mobile share all non-visual logic
      (auth session, Eden client, state) and differ only in
      storage/network/lifecycle. Naming: shared types package renamed to
      @hyros-ai/domain (user rejected 'contracts'). Sharing scopes:
      domain(mobile-safe) / shared(utils) / client-runtime /
      ui-logic(mobile-safe) / ui-components(web+desktop only). Mobile shares
      logic but NOT DOM components."
  - ts: 2026-08-09T10:29:00.851Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
```

### TASK-013 · Reorganize packages/ into sharing scopes (domain, shared, ui-logic, ui-components)

```yaml
id: TASK-013
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T10:27:10.330Z
updated_at: 2026-08-09T10:41:32.513Z
tags:
  - architecture
  - refactor
depends_on:
  - TASK-012
history:
  - ts: 2026-08-09T10:27:10.330Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-09T10:29:01.109Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-09T10:41:32.256Z
    who: "@cline"
    action: commented
    note: "Renamed packages/types -> packages/domain (@hyros-ai/domain) via git mv.
      Updated all refs: 5 tsconfig project references (root, web, desktop,
      gateway, ui), 4 workspace deps (ui, web, desktop, gateway), 2 source
      imports (web App.tsx, gateway index.ts), 2 docs (README, architecture.md),
      bun.lock regenerated (0 old refs remain). Cleaned stale tsbuildinfo
      artifacts (ui crashed on old ../types ref). Verified: full monorepo
      typecheck 15/15 green, gateway bun test 14 pass / 0 fail. Incidental fix:
      removed dead Users demo card from web App.tsx — it called api.users.get()
      but the gateway /users route was intentionally removed during the
      TASK-002-era cleanup (pre-existing typecheck failure, confirmed via git
      show HEAD). Remaining scope notes: utils stays as-is (already the pure
      shared scope); ui split into ui-logic/ui-components deferred until
      headless logic actually exists to extract (currently only Button.tsx)."
  - ts: 2026-08-09T10:41:32.513Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-014 · Extract non-visual client logic into a client-runtime package (auth session, Eden client, state)

```yaml
id: TASK-014
status: done
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T10:27:10.581Z
updated_at: 2026-08-09T10:56:23.467Z
tags:
  - architecture
  - refactor
depends_on:
  - TASK-012
history:
  - ts: 2026-08-09T10:27:10.581Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-09T10:46:59.185Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-09T10:56:23.254Z
    who: "@cline"
    action: commented
    note: "Created packages/client-runtime (@hyros-ai/client-runtime): shared
      non-visual client logic, mobile-safe by construction (no DOM/Node/React).
      Contents: StoredSession + SessionStore platform-seam interface
      (keychain/localStorage/secure-store implementations come in TASK-015) +
      RestoreResult + createSessionManager({store, fetchProfile}) with explicit
      policy: restore = load->verify against gateway->profile; verification
      failure returns 'error' WITHOUT clearing the store (network failure must
      not destroy a valid session); signOut clears. Transport injected
      (fetchProfile), never constructs an API client — unit-testable. DTO
      unification: added UserProfile to @hyros-ai/domain (single source of truth
      for GET /auth/session shape); gateway AuthUser is now a type alias of it;
      desktop App.tsx local SessionUser removed in favor of UserProfile.
      Verified: monorepo typecheck 16/16, client-runtime bun test 4 pass,
      gateway bun test 14 pass. Not done here (by design): desktop Tauri wiring
      of the manager — entangled with Supabase client rehydration, belongs to
      TASK-015 with user E2E verification."
  - ts: 2026-08-09T10:56:23.467Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-015 · Introduce platform-layer DI seam for storage/network/lifecycle (keychain, localStorage, expo-secure-store)

```yaml
id: TASK-015
status: backlog
priority: medium
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T10:27:10.831Z
updated_at: 2026-08-09T10:27:10.831Z
tags:
  - architecture
  - refactor
depends_on:
  - TASK-012
history:
  - ts: 2026-08-09T10:27:10.831Z
    who: "@amjed-bouhouch"
    action: created
```

### TASK-016 · Document architecture decision (client-runtime pattern; rename types->domain @hyros-ai/domain)

```yaml
id: TASK-016
status: done
priority: low
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T10:27:11.077Z
updated_at: 2026-08-09T10:59:07.061Z
tags:
  - architecture
  - docs
depends_on:
  - TASK-012
history:
  - ts: 2026-08-09T10:27:11.077Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-09T10:58:04.854Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-09T10:59:06.858Z
    who: "@cline"
    action: commented
    note: "architecture.md: added decision §10 'Cross-client code sharing' —
      sharing-scope table (domain/utils/client-runtime/api-client/ui) + the four
      anti-duplication rules (consume client-runtime + inject platform layer;
      platform seam SessionStore -> keychain/localStorage/secure-store;
      web+desktop share UI, mobile shares logic only; DTOs live in domain).
      Marked the 'UI sharing depth for mobile' open decision as decided.
      README/architecture layouts already updated in TASK-013/014 commits."
  - ts: 2026-08-09T10:59:07.061Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-017 · Build logged-in user-space layout: dashboard with left sidebar (10 features + settings) and AI chat home

```yaml
id: TASK-017
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T12:57:09.679Z
updated_at: 2026-08-09T16:42:52.290Z
tags:
  - frontend
  - layout
  - ui
history:
  - ts: 2026-08-09T12:57:09.679Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-09T12:58:57.960Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-09T16:42:52.083Z
    who: "@cline"
    action: commented
    note: "Built the logged-in user-space layout in apps/web (uncommitted per user
      request, layout preview only). New files: components/dashboard/sidebar.tsx
      (brand header, 10 features:
      Home/Agents/Workflows/Campaigns/Audiences/Automations/Analytics/Reports/I\
      ntegrations/Billing + Settings under Workspace, user card w/ initials
      avatar + sign-out; uses existing sidebar-* theme tokens), chat-home.tsx
      (AI chat home: greeting, 4 suggestion chips, message thread w/ mock
      assistant reply, composer with Enter-to-send), placeholder-page.tsx
      (coming-soon view per feature), dashboard-layout.tsx (shell: sidebar + top
      bar with search/notifications + content). App.tsx rewritten to render the
      dashboard with a mock UserProfile (web auth not wired yet). State-based
      nav, no router dep. Verified: web typecheck green, production build green,
      vite preview serves HTTP 200, bundle contains dashboard strings + sidebar
      CSS tokens."
  - ts: 2026-08-09T16:42:52.290Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-018 · Show shared user-space dashboard in desktop post-login (move layout into @hyros-ai/ui, Tailwind for desktop)

```yaml
id: TASK-018
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T20:11:18.673Z
updated_at: 2026-08-09T20:20:04.978Z
tags:
  - frontend
  - desktop
  - layout
history:
  - ts: 2026-08-09T20:11:18.673Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-09T20:11:18.989Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-09T20:20:04.724Z
    who: "@cline"
    action: commented
    note: "User-space dashboard now renders in desktop post-login. Refactor per
      sharing-scope architecture (architecture.md §10): moved the 4 dashboard
      components from apps/web/src/components/dashboard into
      packages/ui/src/dashboard (single copy, imported by BOTH web and desktop —
      zero duplication). Added packages/ui/src/lib/cn.ts (clsx + tailwind-merge)
      and deps clsx/tailwind-merge/lucide-react to @hyros-ai/ui. Desktop: added
      Tailwind v4 (@tailwindcss/vite plugin + styles.css ported from web
      globals.css theme tokens, same oklch palette/sidebar tokens), lucide-react
      dep, and rewrote App.tsx: loading splash -> signed-out sign-in screen
      (brand mark + error display + Google button) -> signed-in
      DashboardLayout(user, onSignOut=signOut) with ChatHome on Home and
      PlaceholderPage elsewhere, activeId state for nav. Verified: monorepo
      typecheck 16/16, web build OK, desktop build OK (bundle contains chat home
      + sidebar tokens). User must restart tauri dev to pick up new deps/plugin.
      Uncommitted per user request."
  - ts: 2026-08-09T20:20:04.978Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-019 · Show user-space dashboard layout in desktop app after login (move dashboard components into shared @hyros-ai/ui)

```yaml
id: TASK-019
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-09T20:11:19.311Z
updated_at: 2026-08-09T20:11:47.294Z
tags:
  - frontend
  - desktop
  - layout
history:
  - ts: 2026-08-09T20:11:19.311Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-09T20:11:19.558Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-09T20:11:47.035Z
    who: "@cline"
    action: commented
    note: Duplicate of TASK-018 (created by a duplicated parallel command batch).
      Closing as duplicate.
  - ts: 2026-08-09T20:11:47.294Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-020 · Design agent table: Drizzle schema + migration (name, description, goal, avatar_url, owner FK)

```yaml
id: TASK-020
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-15T10:02:40.335Z
updated_at: 2026-08-15T10:07:19.380Z
tags:
  - db
  - schema
  - agents
history:
  - ts: 2026-08-15T10:02:40.335Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-15T10:03:08.384Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-15T10:05:09.782Z
    who: "@cline"
    action: commented
    note: agents table added to packages/db/src/schema.ts (owner_id FK->users
      cascade, name NOT NULL, description/goal/avatar_url nullable, owner
      index); migration 0001 generated, typecheck clean. Not yet applied to a
      live DB.
  - ts: 2026-08-15T10:05:10.013Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
  - ts: 2026-08-15T10:07:19.380Z
    who: "@cline"
    action: commented
    note: Dropped goal column per user; regenerated clean 0001 migration (never
      applied to live DB, so no ALTER-DROP noise). 7 cols, typecheck clean.
```

### TASK-021 · SPIKE: AgentController + built-in ask_user suspend/resume + DurableAgent compat + restart behavior

```yaml
id: TASK-021
status: done
priority: urgent
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-15T10:30:31.435Z
updated_at: 2026-08-15T11:09:12.929Z
tags:
  - agents
  - spike
  - mastra
history:
  - ts: 2026-08-15T10:30:31.435Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-15T10:30:40.713Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-15T11:09:12.708Z
    who: "@cline"
    action: commented
    note: "ALL PASS on @mastra/core 1.59: (1) ask_user round-trip: approval gate ->
      tool_suspended {question} -> session.respondToToolSuspension -> answer
      reaches run. (2) Memory REQUIRED for message persistence (controller
      memory param); verified 3 msgs in mastra_messages. (3) CRASH TEST:
      suspended run survives process kill in storage; recovery =
      agent.listSuspendedRuns() -> session.suspensions.register() re-park
      (in-memory parked set is NOT rehydrated) ->
      session.respondToToolSuspension. Raw agent.resumeStream FAILS (loses
      controller-injected tools). (4) DurableAgent backing WORKS with
      controller. API reality vs docs: everything on Session
      (subscribe/sendMessage/respondToToolSuspension), no selectOrCreateThread
      (createSession auto-binds), workspace REQUIRED for sessions, controllers
      register on Mastra via agentControllers."
  - ts: 2026-08-15T11:09:12.929Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-022 · Storage: swap Mastra LibSQL -> @mastra/pg PostgresStore on DATABASE_URL + apply Drizzle migration 0001 (fallback: keep LibSQL, document why)

```yaml
id: TASK-022
status: in_progress
priority: high
assigned_to: null
claimed_by: "@cline"
created_by: "@amjed-bouhouch"
created_at: 2026-08-15T10:30:31.663Z
updated_at: 2026-08-15T11:21:48.340Z
tags:
  - db
  - mastra
  - storage
history:
  - ts: 2026-08-15T10:30:31.663Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-15T11:09:35.392Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-15T11:21:48.340Z
    who: "@cline"
    action: commented
    note: "Progress: @mastra/pg installed; Drizzle migration 0001 APPLIED to prod
      (agents table + index verified via pg). Journal fix: prod had 0000
      tables/enum pre-existing without journal row, so drizzle-kit migrate
      failed on CREATE TYPE — inserted journal row and applied via drizzle-orm
      migrator directly. STILL TO DO: swap LibSQLStore->PostgresStore in
      src/mastra/index.ts (constructor + init() creates mastra_* tables — verify
      on boot), keep spike green. Full handoff: docs/agent-harness-plan.md"
  - ts: 2026-08-15T12:11:58.000Z
    who: "@cline"
    action: commented
    note: "Storage swap code-complete, 3/4 verifications PASS: (1) typecheck clean.
      (2) gateway boots on PostgresStore — /health OK, /mastra/api/agents lists
      supportAgent. (3) 37 mastra_* tables auto-created in public schema
      (information_schema-verified). API notes (installed @mastra/pg 1.20.0
      .d.ts, plan snippet was wrong): ssl is boolean|ConnectionOptions — no
      'require' string (used {rejectUnauthorized:false} = postgres.js 'require'
      equivalent, mirroring db/client.ts local-detection); 'prepare' is
      postgres.js-only, dropped (pg never auto-prepares); table creation is LAZY
      per-domain on first storage op (ensureDomainReady->initStorage), not on
      bare boot. (4) SPIKE REGRESSION BLOCKED — not run: cline-pass HTTP 429
      INFERENCE_CAP_ERROR 'You have reached your 5-hour Clinepass limit. The
      limit resets in 1h 44m' (hit ~12:08Z, reset ~13:55Z Aug 15). Spike script
      itself already swapped to PostgresStore; rerun full +
      --suspend-exit/--resume cycle after reset and only then close task. Not
      closing yet per task rule."
```

### TASK-023 · Agent runtime factory: DB row -> Agent (dynamic spawn/persona instructions) -> AgentController; boot registry sync + crash recovery

```yaml
id: TASK-023
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-15T10:30:31.883Z
updated_at: 2026-08-15T15:03:01.721Z
tags:
  - agents
  - mastra
  - core
history:
  - ts: 2026-08-15T10:30:31.883Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-15T14:43:38.707Z
    who: "@cline"
    action: commented
    note: "Implementation REVERTED (commits 7e7eed0+bbaaec2 removed; backup tag
      backup/task-023-reverted). Two-axis review of the reverted code: (1) BUG
      agents.ts:198 owner fallback 'resourceId ?? threadId ?? unknown' violates
      locked mapping resourceId=ownerId — dropped fix in rework; (2) relied on
      @internal __registerMastra for runtime registration without verifying the
      no-registration path the spec required; (3) smells: unknown magic string,
      template replaceAll duplication, N+1 row loads, agents.ts vs agents/
      naming collision. Rework from scratch with these as the checklist."
  - ts: 2026-08-15T14:50:42.049Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-15T15:03:01.721Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-024 · update_profile tool: agent persists its own name/description/avatar seed to agents row

```yaml
id: TASK-024
status: done
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-15T10:30:32.148Z
updated_at: 2026-08-15T15:03:01.944Z
tags:
  - agents
  - tools
  - db
history:
  - ts: 2026-08-15T10:30:32.148Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-15T14:50:42.276Z
    who: "@cline"
    action: claimed
    from: backlog
    to: in_progress
  - ts: 2026-08-15T15:03:01.944Z
    who: "@cline"
    action: completed
    from: in_progress
    to: done
```

### TASK-025 · Gateway agents API: POST /agents (create+kickoff), GET /agents (chat list w/ last message), POST /agents/:id/messages (send/steer/resume-suspension glue), GET /agents/:id/events (SSE displayState)

```yaml
id: TASK-025
status: backlog
priority: high
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-15T10:30:32.367Z
updated_at: 2026-08-15T15:18:26.449Z
tags:
  - gateway
  - api
  - agents
history:
  - ts: 2026-08-15T10:30:32.367Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-15T15:03:02.153Z
    who: "@cline"
    action: commented
    note: "Scope partially absorbed by TASK-023 rework: POST /chat (SSE) is DONE and
      E2E-verified (isNew create + spawn interview via ask_user +
      suspension-resume answers + persona flip + update_profile persistence,
      DiceBear Clay avatar). Remaining for TASK-025: GET /agents (chat list w/
      last message) + GET /chat/:agentId/events (reattach on app reopen) + web
      auth decision (DEV_USER_ID env-gated escape now in guard.ts)."
  - ts: 2026-08-15T15:18:26.449Z
    who: "@cline"
    action: commented
    note: "GET /chat/:agentId/events DONE (SSE: session+snapshot+live events+25s
      heartbeat). POST /chat now fire-and-forget 200-empty (client-generated
      uuid on isNew = idempotent). Shared zustand chat store in
      @hyros-ai/client-runtime (createChatStore, EventSource injected) —
      live-smoke PASS vs gateway. Remaining: GET /agents chat list +
      auth-token-in-SSE decision (EventSource headers)."
```

### TASK-026 · Web: wire MessagingApp to agents API (plus button, real chat list w/ string ids, SSE thread rendering, ask_user inline)

```yaml
id: TASK-026
status: backlog
priority: medium
assigned_to: null
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-15T10:30:32.581Z
updated_at: 2026-08-15T15:18:26.754Z
tags:
  - web
  - ui
  - agents
history:
  - ts: 2026-08-15T10:30:32.581Z
    who: "@amjed-bouhouch"
    action: created
  - ts: 2026-08-15T15:18:26.754Z
    who: "@cline"
    action: commented
    note: "Client foundation ready: createChatStore in packages/client-runtime
      (attach/detach/send/createAgent). Wire MessagingApp: plus button ->
      createAgent(), chat list -> GET /agents (TASK-025), thread ->
      store.agents[id], ask_user -> pendingQuestion inline UI. Smoke script:
      src/chat-store.smoke.ts."
```
