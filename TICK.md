---
project: hyros-ai
schema_version: "1.0"
created: Mon Aug 03 2026 20:25:27 GMT+0100 (Central European Standard Time)
updated: 2026-08-03T19:46:41.683Z
default_workflow: [backlog, todo, in_progress, review, done]
id_prefix: TASK
next_id: 7
---

## Agents

| Agent | Type | Role | Status | Working On | Last Active | Trust Level |
|-------|------|------|--------|------------|-------------|-------------|
| @cline | bot | engineer, auth, backend, frontend | idle | - | 2026-08-03T19:45:01.998Z | trusted |

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
status: backlog
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:45:26.823Z
updated_at: 2026-08-03T19:45:26.823Z
tags:
  - auth
  - config
  - backend
history:
  - ts: 2026-08-03T19:45:26.823Z
    who: "@amjed-bouhouch"
    action: created
```

> Foundation task for both backend & desktop tracks. Deliverables: (1) Add Supabase env vars to .env.example and the gateway — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server/verify) and the anon key for the desktop client. (2) Add @supabase/supabase-js dependency to gateway + desktop. (3) Create a shared Supabase client config module. (4) Document the manual one-time steps the operator must do in the Supabase dashboard (create project, enable Google OAuth provider, configure redirect URIs incl. the Tauri custom-protocol deep link, set the JWT secret). No app behavior changes yet — this unblocks TASK-003 and TASK-006. Per agent-os-architecture.md §4.

### TASK-003 · Gateway: Supabase JWT auth middleware on Elysia

```yaml
id: TASK-003
status: backlog
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:45:47.895Z
updated_at: 2026-08-03T19:45:47.895Z
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
```

> Add an Elysia guard/derive middleware that verifies the Supabase access token (Bearer header) and attaches the authenticated user (id, email, name, avatar) to the request context. Use the Supabase service-role client (supabase.auth.getUser(token)) or local JWT verification via the Supabase JWKS/jwt secret. Return 401 on missing/invalid token. Exempt public routes (/health, /mastra read-only smoke). This is the auth gate that all protected routes depend on. Per agent-os-architecture.md §3 (Elysia = control plane incl. auth) and §4.
> ken JWT) usable to call the gateway. Per agent-os-architecture.md §9 (Tauri native needs: keychain token storage, shell plugin to open URLs, deep-link for callbacks).

### TASK-004 · Desktop: Supabase client + Google OAuth flow for Tauri

```yaml
id: TASK-004
status: backlog
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.188Z
updated_at: 2026-08-03T19:46:41.188Z
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
```

> Client-side Google sign-in that works inside a Tauri v2 webview. Use supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo:'hyros://auth/callback' (Tauri deep-link custom protocol), flowType:'pkce' } }) opened in the system browser via the shell plugin; on the deep-link callback, exchangeCodeForSession to obtain a Supabase session. Persist the session securely (Tauri secure-storage / keychain via a Rust #[tauri::command], NOT plain localStorage). Output: a Supabase session whose access_token (JWT) the desktop app can send to the gateway. Per agent-os-architecture.md §9 (native needs: keychain token storage, shell plugin to open URLs, deep-link for callbacks).

### TASK-005 · Gateway: upsert user profile from Supabase on auth

```yaml
id: TASK-005
status: backlog
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.447Z
updated_at: 2026-08-03T19:46:41.447Z
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
```

> Bridge Supabase auth to the Drizzle app schema. On an authenticated request, ensure a row exists in packages/db users table (id = Supabase auth user id; upsert cached email/name/avatarUrl from the verified token). This is what makes the app actually know who the user is (the users table is the app-level profile keyed by the Supabase auth uid per schema.ts). Optionally auto-provision the individual organization + organization_memberships row at first login per arch §2 (kept as a follow-up if out of minimal scope). Re-export the typed db client to the gateway. Per agent-os-architecture.md §4 and schema.ts.

### TASK-006 · Gateway: protected /auth/session (me) endpoint

```yaml
id: TASK-006
status: backlog
priority: high
assigned_to: "@cline"
claimed_by: null
created_by: "@amjed-bouhouch"
created_at: 2026-08-03T19:46:41.683Z
updated_at: 2026-08-03T19:46:41.683Z
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
```

> Add a protected GET endpoint (e.g. /auth/session or /me) guarded by the TASK-003 middleware that returns the current authenticated user (Supabase identity + the Drizzle app profile). This is what the desktop app calls after restoring a session to confirm it is still valid and to load the user object. Return 401 when unauthenticated. Per agent-os-architecture.md §3 (Elysia = auth gate exposing identity to clients).
