# Agent schedules

## Product contract

Each user-created agent can manage its own recurring work through four tools:
`create_schedule`, `list_schedules`, `update_schedule`, and `delete_schedule`.
The agent detail panel shows the resulting schedules but never mutates them.
Users change or delete a schedule by asking the agent in chat. Archiving an
agent deletes all of its schedules before the archive is committed.

## Runtime design

DB-backed agents are constructed lazily inside `AgentController` instances and
are deliberately absent from the shared Mastra registry. Native agent schedules
cannot resolve those agents after a cold start. Instead, every schedule targets
one statically registered `run-dynamic-agent-schedule` workflow. Its persisted
input carries the target agent id, owner id, display name, and prompt. On fire,
the workflow verifies the active owned agent row, rebuilds or reuses its runtime,
opens the existing controller session, and sends the prompt. It skips delivery
when the session is already running or waiting on a suspension.

The schedule service is the only caller of `mastra.schedules`. It derives tenant
identity from the runtime closure and stores both owner and agent ids in schedule
metadata. Reads, updates, and deletes verify this metadata before touching a
schedule. The model can never choose either identifier.

## UI and data flow

`GET /agents/:agentId/schedules` verifies ownership and returns a small shared
DTO: id, name, prompt, cron, timezone, status, and next/last fire timestamps.
The desktop transport loads this endpoint when the detail panel opens. A
completed agent turn invalidates the schedule cache, so a conversational create,
update, or delete appears on the next panel refresh without UI mutation controls.

The panel presents a compact `Schedules` section below the profile. Rows show
name, a readable cadence, timezone, and active/paused state. The empty state
teaches the conversational interaction: “No schedules yet. Ask your agent to
schedule recurring work.” Loading and failure states remain local to the panel.

## Verification

Focused service tests cover tenant filtering, cross-agent rejection, update
preservation, and archive cleanup. Transport tests cover the authenticated list
request. Repository typechecks verify the workflow, Elysia contract, shared DTO,
desktop wiring, and presentational component boundaries.
