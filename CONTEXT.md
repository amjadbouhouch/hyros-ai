# Hyros Agent Runtime

This context defines the identity and communication language used by user-owned agents in the Hyros runtime.

## Language

**Agent ID**:
An immutable UUID used internally for an agent's database row, chat thread, runtime, schedules, and workspace.
_Avoid_: Agent address, display name

**Agent address**:
A canonical slug derived from the display name and unique within one user's agent directory. Agents use this address for routing; it is not the agent's internal identity.
_Avoid_: Agent ID, UUID

**Display name**:
The human-readable agent name shown to the user and used to derive the agent address.
_Avoid_: Agent ID

**Agent message**:
An asynchronous Mastra signal carrying a task, question, notification, or correlated reply between two agents belonging to the same user.
_Avoid_: User message, subagent call
