# Mastra agent-to-agent communication for Hyros AI

Research target: the installed `@mastra/core@1.59.0`. The conclusions below use that package's embedded documentation and type/source declarations, checked against Mastra's [official documentation](https://mastra.ai/docs/capabilities/subagents) and the [tagged 1.59.0 source](https://github.com/mastra-ai/mastra/blob/c5702d34a575742e7b7e922d370a67b39e418d4f/packages/core/CHANGELOG.md).

## Recommendation

Use a **hybrid with two deliberately different operations**:

1. **`delegate` (foreground, request/response):** expose the owner's other agents as Mastra native subagents through the parent `Agent`'s dynamic `agents` resolver. Agent A delegates a bounded task to B, waits for B's answer, and synthesizes it into A's reply. This should be the default collaboration path. On 1.59, explicitly set `backgroundTasks: { disabled: true }` on these supervisor agents so this contract stays synchronous.
2. **`message_agent` (asynchronous, persistent peer message):** add an explicit Hyros tool that addresses B's normal thread and delivers an attributed Mastra signal. B may wake independently and must explicitly message A back if a reply is required.

This preserves the product distinction users will expect: **delegation returns work to the caller; messaging changes another agent's own conversation.** Do not pretend the two have the same memory or completion semantics.

Ship native foreground delegation first. Add peer messaging after a shared distributed PubSub/lease backend is in place. The current gateway has no configured PubSub, and every dynamic `AgentController` builds an internal Mastra instance around storage, so message delivery is only safe in a single gateway process today.

## Why native dynamic subagents are the primary mechanism

Mastra's supervisor pattern turns entries in `AgentConfig.agents` into delegation tools. The parent chooses an agent from its description, sends it a task, receives its result, and continues its own loop. Delegation hooks can authorize or rewrite the request, filter conversation messages, cap steps, and inspect completion. Approval/suspension and cancellation propagate through the delegation chain. Mastra explicitly recommends this over the deprecated `.network()` API. See [Subagents](https://mastra.ai/docs/capabilities/subagents), [agent networks](https://mastra.ai/docs/agents/networks), and the [1.59 `AgentConfig.agents` type](https://github.com/mastra-ai/mastra/blob/c5702d34a575742e7b7e922d370a67b39e418d4f/packages/core/src/agent/types.ts).

Crucially for Hyros, `agents` is a `DynamicArgument`: its resolver may be async and receives `requestContext`. The installed source resolves it per request through `Agent.listAgents()`, so it fits DB-backed, user-owned agents without boot-time registration; see the [tagged `Agent` implementation](https://github.com/mastra-ai/mastra/blob/c5702d34a575742e7b7e922d370a67b39e418d4f/packages/core/src/agent/agent.ts).

Mastra isolates delegated memory: B receives filtered parent context, but only the delegation prompt and B's response are saved for B, in a fresh thread per invocation. Therefore native delegation **does not write into B's normal Hyros chat thread**. That is desirable for task calls, but it is not peer messaging.

### Mapping to `apps/gateway/src/chat/runtime.ts`

The current runtime already has the needed ownership and lazy-construction boundaries:

- Extend the request context passed from the route/session with `ownerId`, `sourceAgentId`, and a serializable `delegationPath`.
- Add `agents: async ({ requestContext }) => ...` when constructing each `Agent`.
- Set `backgroundTasks: { disabled: true }` for the first release. In 1.59, `Mastra.addAgent()` automatically enables a background-task manager when it detects static or dynamic subagents; the current AgentController drive does not use `untilIdle`, so leaving that implicit behavior on would change delegation into acknowledgement-first execution. This behavior is visible in the [tagged Mastra registration source](https://github.com/mastra-ai/mastra/blob/c5702d34a575742e7b7e922d370a67b39e418d4f/packages/core/src/mastra/index.ts).
- Query only non-archived, fully onboarded rows belonging to `ownerId`; exclude self and IDs already in `delegationPath`.
- Set each runtime `Agent`'s `description` from the DB row (the current constructor omits it). Lazily obtain each target through `getRuntime({ row, mastra })` and expose its initialized backing agent under a stable tool-safe key. Mastra uses that description for routing.
- In `onDelegationStart`, re-check same-owner authorization, append the target ID to `delegationPath`, reject cycles/depth above a small limit (for example 3), and cap child steps. Use `messageFilter` to avoid forwarding secrets or an unbounded chat history.
- Keep the existing agent directory in the prompt for awareness; capability comes from the native subagent registry, not from the prompt alone.

The controller initialization already propagates memory, storage, workspace, observability, and an internal Mastra instance onto its backing agent in [`AgentController.propagateRuntimeServicesToAgent`](https://github.com/mastra-ai/mastra/blob/c5702d34a575742e7b7e922d370a67b39e418d4f/packages/core/src/agent-controller/agent-controller.ts). Expose that initialized backing agent from `AgentRuntime`; do not construct a second target agent inside the resolver.

Sketch only:

```ts
new Agent({
  // existing id/name/model/instructions/tools
  backgroundTasks: { disabled: true },
  agents: async ({ requestContext }) => {
    const ownerId = requestContext.get("ownerId")
    const path = requestContext.get("delegationPath") ?? [row.id]
    const peers = await listAuthorizedPeers(ownerId, row.id, path)

    return Object.fromEntries(
      await Promise.all(peers.map(async peer => {
        const runtime = await getRuntime({ row: peer, mastra })
        return [subagentKey(peer.id), runtime.agent]
      })),
    )
  },
  defaultOptions: {
    delegation: { onDelegationStart, messageFilter },
  },
})
```

Avoid using agent names as map keys: names are mutable and may collide. Use an ID-derived, provider-safe key while keeping the human name and description in agent metadata/config.

## Persistent asynchronous peer messaging

Mastra's experimental thread Signals APIs address an active run or wake an idle thread. `sendMessage()`/`queueMessage()` represent user-authored input; `sendSignal()` is the better semantic match for agent/system context. A signal can include XML-visible attributes, active/idle delivery policies, and the target `resourceId`/`threadId`. Delivered input joins the target's memory thread. See [Signals](https://mastra.ai/docs/long-running-agents/signals) and the [1.59 message/signal types](https://github.com/mastra-ai/mastra/blob/c5702d34a575742e7b7e922d370a67b39e418d4f/packages/core/src/agent/types.ts).

Implement this as a host-owned tool rather than as “agent as tool”:

```ts
message_agent({
  targetAgentId,
  content,
  correlationId,
  replyRequested,
})
```

Its executor should:

1. Authorize `sourceAgentId` and `targetAgentId` against the same authenticated owner; never accept `ownerId` from model arguments.
2. Resolve the target runtime and create/get its normal session first.
3. Call the target backing agent's `sendSignal()` with `resourceId: ownerId`, `threadId: targetAgentId`, an agent-message tag, and attributes such as `fromAgentId`, `fromAgentName`, and `correlationId`. For an idle wake, pass trusted owner/source/path values in `ifIdle.streamOptions.requestContext`; otherwise the newly started target run cannot safely resolve its dynamic peers.
4. Deliver to an active run or wake an idle one. Return an acknowledgement after Mastra accepts routing, **not** B's eventual answer.
5. Require B to call `message_agent` back with the correlation ID. Enforce hop count, rate limits, deduplication, payload size, and per-owner quotas to prevent loops and surprise spend.

If a durable unread inbox is required, evaluate `sendNotificationSignal()` as the next layer: PostgreSQL supports Mastra notification records and delivery policies. It is still an experimental API and should not replace a Hyros-owned message/audit record if product guarantees require exactly-once delivery or admin-visible history.

### Distributed requirement

Mastra documents that the default in-memory PubSub cannot route signals between server instances. Without shared PubSub and leasing, two instances may both run the same thread. Configure one `RedisStreamsPubSub` for the gateway and pass that same instance into every dynamic `AgentController` (or otherwise attach every runtime to the same Mastra services). The current `apps/gateway/src/mastra/index.ts` has storage and observability but no `pubsub`, and `runtime.ts` passes only storage and observability to each controller. Until this is fixed, peer messages must be treated as single-process-only. See [Signals: distributed deployments](https://mastra.ai/docs/long-running-agents/signals#distributed-and-serverless-deployments) and [Mastra PubSub](https://mastra.ai/docs/server/pubsub).

AgentController sessions are live, in-memory runtime state; threads and selected settings persist, but session event buses, grants, and active-run state do not automatically survive recreation. That boundary is explicit in the [AgentController guide](https://mastra.ai/docs/harness/agent-controller) and [tagged Session source](https://github.com/mastra-ai/mastra/blob/c5702d34a575742e7b7e922d370a67b39e418d4f/packages/core/src/agent-controller/session.ts).

## Options rejected or reserved

| Mechanism | Verdict | Reason |
| --- | --- | --- |
| Native dynamic subagents | **Use for delegation** | Built-in routing, streaming, hooks, cancellation, approval propagation, and result synthesis. Fresh delegated memory is correct for bounded work. |
| AgentController `subagents` definitions | Do not use for user-owned peers | They create constrained/forked helper executions owned by one controller; they are ideal for roles such as reviewer/researcher, not for invoking another user's persisted agent persona/thread. See [AgentController subagents](https://mastra.ai/docs/harness/agent-controller#delegate-to-subagents). |
| Custom “agent as tool” calling `target.generate()` | Avoid for synchronous work | Reimplements native subagent conversion and loses built-in delegation hooks, nested stream metadata, approval/suspension propagation, and context filtering. A custom tool is justified only for the different asynchronous message contract. |
| `agent.network()` | Do not start new work | Officially deprecated in favor of supervisor/subagent `generate()` and `stream()`. See [Agent networks](https://mastra.ai/docs/agents/networks). |
| Workflow with agent steps | Reserve for explicit protocols | Good for predetermined fan-out/review/approval pipelines and typed outputs, not open-ended conversational routing. Workflows can call agents and suspend/resume; see [Agents in workflows](https://mastra.ai/docs/workflows/agents-and-tools) and [workflow suspend/resume](https://mastra.ai/docs/workflows/suspend-and-resume). |
| Background subagents | Later | Mastra can dispatch subagent tool calls through the background task manager and re-enter the parent with `untilIdle`. In 1.59, registering an agent that has subagents auto-enables a manager unless explicitly disabled. Hyros' current AgentController path does not use `untilIdle`, and each dynamic controller owns a separate internal Mastra, so phase 1 should force foreground delegation. See [Background tasks](https://mastra.ai/docs/long-running-agents/background-tasks). |
| Durable agents | Later, for long jobs | Durable wrappers checkpoint loop/tool boundaries and support recovery, but the current controller drives ordinary agents and has custom suspension recovery only. Automatic recovery can reissue LLM/tool calls, tools must be idempotent, and multi-replica recovery needs an external leader/lease. See [Durable agents](https://mastra.ai/docs/long-running-agents/durable-agents). |
| A2A protocol | Not for in-process peers | Appropriate across services/vendors. It adds HTTP discovery/task infrastructure, and Mastra's A2A task records are currently in-memory for resume. See [Mastra A2A](https://mastra.ai/docs/agents/a2a). |

## Suggested delivery sequence

1. Add owner-scoped request context and dynamic native subagents; test authorization, self/cycle exclusion, description routing, child failure, suspension propagation, and context filtering.
2. Add shared Redis Streams PubSub/leases to the central Mastra and every dynamic controller; test two gateway replicas against the same target thread.
3. Add the explicit `message_agent` signal tool plus correlation/hop/rate controls and a product-visible audit record.
4. Add workflows/background or durable execution only for jobs whose lifecycle truly outlives a chat request; do not make them the base communication transport.
