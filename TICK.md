---
project: hyros-ai
schema_version: "1.0"
created: Mon Aug 03 2026 20:25:27 GMT+0100 (Central European Standard Time)
updated: 2026-08-03T19:45:26.823Z
default_workflow: [backlog, todo, in_progress, review, done]
id_prefix: TASK
next_id: 3
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
