---
project: hyros-ai
schema_version: "1.0"
created: Mon Aug 03 2026 20:25:27 GMT+0100 (Central European Standard Time)
updated: 2026-08-04T15:40:50.002Z
default_workflow: [backlog, todo, in_progress, review, done]
id_prefix: TASK
next_id: 8
---

## Agents

| Agent | Type | Role | Status | Working On | Last Active | Trust Level |
|-------|------|------|--------|------------|-------------|-------------|
| @cline | bot | engineer, auth, backend, frontend | working | TASK-007 | 2026-08-04T15:40:50.002Z | trusted |

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
updated_at: 2026-08-03T19:45:16.728Z
tags:
  - auth
  - epic
history:
  - ts: 2026-08-03T19:45:16.728Z
    who: "@amjed-bouhouch"
    action: created
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
status: in_progress
priority: high
assigned_to: "@cline"
claimed_by: "@cline"
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.919Z
updated_at: 2026-08-04T15:40:50.002Z
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
```

> Build the user-facing auth surface in the Tauri React app. Login screen with a Sign in with Google button (wires to the TASK-004 OAuth flow); logged-in view showing user email/name/avatar + a Sign out button (supabase.auth.signOut); session restored from secure storage on app start and validated via the gateway /auth/session endpoint; route the app between logged-out and logged-in states. No other features — just login/logout. Per agent-os-architecture.md §9 (desktop app is a minimal cloud client).
