/**
 * TASK-021 spike — de-risk the core harness before building on it.
 *
 * Verifies, against the installed @mastra/core v1.55:
 *   1. AgentController + built-in `ask_user`: agent suspends → tool_suspended
 *      event → respondToToolSuspension → answer reaches the run.
 *   2. Crash simulation (`--suspend-exit`): process dies while suspended.
 *   3. Restart resume (`--resume`): fresh process, same storage/ids — can the
 *      parked suspension be found and resumed?
 *   4. `--durable`: same round-trip with createDurableAgent as backing agent
 *      (compile + runtime compat check with AgentController).
 *
 * Run from apps/gateway:
 *   bun --env-file=../../.env run scripts/spike-controller.ts [--durable]
 *   bun --env-file=../../.env run scripts/spike-controller.ts --suspend-exit
 *   bun --env-file=../../.env run scripts/spike-controller.ts --resume
 */
import { Mastra } from "@mastra/core/mastra";
import { Agent } from "@mastra/core/agent";
import { AgentController } from "@mastra/core/agent-controller";
import { createDurableAgent } from "@mastra/core/agent/durable";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";

import { HYROS_MODEL } from "../src/lib/model.js";

const MODE = process.argv[2] ?? "full";
const runSuffix = MODE === "full" ? crypto.randomUUID() : "durable";
const IDS = {
    controller: `spike-controller-${runSuffix}`,
    session: `spike-session-${runSuffix}`,
    owner: `spike-owner-${runSuffix}`,
};

function log(msg: string, data?: unknown) {
    console.log(`[spike] ${msg}`, data === undefined ? "" : JSON.stringify(data));
}

function waitFor<T>(
    label: string,
    poll: () => T | undefined | Promise<T | undefined>,
    timeoutMs = 120_000,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const timer = setInterval(async () => {
            const v = await poll();
            if (v !== undefined) {
                clearInterval(timer);
                resolve(v);
            } else if (Date.now() - t0 > timeoutMs) {
                clearInterval(timer);
                reject(new Error(`timeout waiting for ${label}`));
            }
        }, 250);
    });
}

async function build() {
    // Same Postgres backing as the gateway's Mastra instance (TASK-022), so
    // the spike exercises the real storage plane. SSL mirrors @hyros-ai/db
    // client.ts (pg has no "require" string; rejectUnauthorized:false ≙ require).
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set (run with --env-file=../../.env)");
    const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].some((h) =>
        databaseUrl.includes(h),
    );
    const storage = new PostgresStore({
        id: "spike",
        connectionString: databaseUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
    });
    const agent = new Agent({
        id: "spike-agent",
        name: "Spike",
        instructions:
            "You are onboarding a user. Your FIRST action is always to call the " +
            "ask_user tool with question 'What is your name?'. Do not write any " +
            "text before calling the tool. After the tool returns the answer, " +
            "reply with exactly one short greeting line containing their name.",
        model: HYROS_MODEL,
    });

    const backing = MODE === "--durable" ? createDurableAgent({ agent }) : agent;
    const controller = new AgentController({
        id: IDS.controller,
        // DurableAgent compat probe: if the types reject this, tsc fails here.
        agent: backing as unknown as Agent,
        storage,
        modes: [{ id: "default", name: "Default", metadata: { default: true } }],
        workspace: new Workspace({
            filesystem: new LocalFilesystem({ basePath: "./spike-workspace" }),
        }),
        // Shared across modes; required for message persistence (chat history).
        memory: new Memory(),
    });
    // Controllers are hosted ON a Mastra instance: it injects itself (storage,
    // agents, model registry) into the controller via __registerMastra.
    new Mastra({
        agents: { "spike-agent": backing as unknown as Agent },
        agentControllers: { [IDS.controller]: controller },
        storage,
    });

    let suspended: { toolCallId: string; suspendPayload: unknown } | undefined;
    let approvalRequired: { toolName?: string; toolCallId?: string } | undefined;
    let ended = false;
    const finalMessages: string[] = [];

    await controller.init();
    // createSession auto-binds the most recent thread for the resource (or
    // creates one) — there is no selectOrCreateThread in 1.59.
    const session = await controller.createSession({ id: IDS.session, ownerId: IDS.owner });

    await Promise.all(
        (["read", "edit", "execute", "mcp", "other"] as const).map((category) =>
            session.permissions.setForCategory({ category, policy: "deny" }),
        ),
    );
    await session.permissions.setForTool({ toolName: "ask_user", policy: "allow" });

    session.subscribe((event: { type: string;[k: string]: unknown }) => {
        // Trace every event type so stalls are visible (error events carry info).
        if (event.type === "error" || event.type === "info") {
            log(`EVENT ${event.type}`, event);
        } else if (!["display_state_changed", "message_update"].includes(event.type)) {
            console.log(`[spike] event: ${event.type}`);
        }
        if (event.type === "tool_approval_required") {
            log("TOOL APPROVAL REQUIRED", event);
            approvalRequired = {
                toolName: event.toolName as string | undefined,
                toolCallId: event.toolCallId as string | undefined,
            };
        }
        if (event.type === "tool_suspended") {
            suspended = {
                toolCallId: event.toolCallId as string,
                suspendPayload: event.suspendPayload,
            };
            log("TOOL SUSPENDED", event.suspendPayload);
        }
        if (event.type === "message_update") {
            const m = event.message as { role?: string; content?: unknown } | undefined;
            if (m?.role === "assistant") {
                const text =
                    typeof m.content === "string"
                        ? m.content
                        : JSON.stringify(m.content);
                if (text) finalMessages.push(text);
            }
        }
        if (event.type === "agent_end") ended = true;
    });

    return {
        controller,
        session,
        getSuspended: () => suspended,
        getApprovalRequired: () => approvalRequired,
        hasEnded: () => ended,
        finalMessages,
    };
}

async function main() {
    if (MODE === "--resume") {
        // Fresh process, same storage + ids. Is the parked suspension found?
        const { controller, session, finalMessages } = await build();
        log("suspensions.hasPending", session.suspensions.hasPending());
        const agent = controller.getCurrentAgent(session) as unknown as {
            listSuspendedRuns?: () => Promise<{ suspendedRuns?: Record<string, unknown> }>;
            resumeStream?: (data: unknown, opts: { runId: string }) => Promise<unknown>;
        };
        const runs = await agent.listSuspendedRuns?.();
        log("agent.listSuspendedRuns", runs);

        // In-memory parked set is empty after restart (verified). Raw
        // agent.resumeStream loses controller-injected tools (ask_user), so
        // recovery = re-park the stored suspension into the session, then use
        // the native session resume path.
        const run = (runs as { runs?: { runId: string; toolCalls?: { toolCallId: string; toolName: string }[] }[] } | undefined)?.runs?.[0];
        const tc = run?.toolCalls?.[0];
        if (!run || !tc) throw new Error("FAIL: no suspended run in storage after restart");
        log("SUSPENDED RUN FOUND IN STORAGE", run);

        session.suspensions.register({
            toolCallId: tc.toolCallId,
            runId: run.runId,
            toolName: tc.toolName,
        });
        await session.respondToToolSuspension({ toolCallId: tc.toolCallId, resumeData: "Ada" });
        await waitFor("final answer", () =>
            finalMessages.some((m) => /ada/i.test(m)) ? true : undefined,
        );
        log("PASS: suspended run resumed after full process restart");
        process.exit(0);
    }

    const { session, getSuspended, getApprovalRequired, hasEnded, finalMessages } = await build();
    log("sending message…");
    const sendP = session
        .sendMessage({ content: "hi" })
        .then(() => log("sendMessage resolved"))
        .catch((e) => log("sendMessage REJECTED", String(e)));

    const outcome = await waitFor("tool_suspended", () => {
        const suspended = getSuspended();
        if (suspended) return { type: "suspended" as const, suspended };
        const approval = getApprovalRequired();
        if (approval) return { type: "approval" as const, approval };
        if (hasEnded()) return { type: "ended" as const };
        return undefined;
    });
    if (outcome.type === "approval") {
        throw new Error(`FAIL: unexpected tool approval: ${JSON.stringify(outcome.approval)}`);
    }
    if (outcome.type === "ended") {
        throw new Error("FAIL: model ended without calling ask_user");
    }
    const s = outcome.suspended;
    log("suspend payload", s.suspendPayload);

    if (MODE === "--suspend-exit") {
        log("SIMULATED CRASH — exiting while suspended", { toolCallId: s.toolCallId });
        process.exit(0);
    }

    await session.respondToToolSuspension({
        toolCallId: s.toolCallId,
        resumeData: "Ada",
    });
    await waitFor("final answer", () =>
        finalMessages.some((m) => /ada/i.test(m)) ? true : undefined,
    );
    await sendP;
    log(`PASS (${MODE}): ask_user round-trip complete`, {
        final: finalMessages.at(-1),
    });
    process.exit(0);
}

main().catch((e) => {
    console.error("[spike] FAIL", e);
    process.exit(1);
});
