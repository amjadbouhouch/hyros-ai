---
project: hyros-ai
schema_version: "1.0"
created: Mon Aug 03 2026 20:25:27 GMT+0100 (Central European Standard Time)
updated: 2026-08-03T19:45:16.728Z
default_workflow: [backlog, todo, in_progress, review, done]
id_prefix: TASK
next_id: 2
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
