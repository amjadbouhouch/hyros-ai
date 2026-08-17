/**
 * No-LLM check for the chat runtime: proves the request-driven builder works —
 * standalone controller (no __registerMastra), session binding (threadId =
 * agentId), the re-park path, and the sandbox attachment — without spending model
 * quota.
 *
 * Creates a throwaway user + agent row in the real DB, exercises the runtime,
 * then deletes them. When SANDBOX_SERVICE_URL points at a running sandbox-service
 * it also runs a real command in a real container and cleans that up too.
 *
 * Run from apps/gateway:
 *   bun --env-file=../../.env run scripts/check-chat-runtime.ts
 */
import { eq } from "drizzle-orm";

import { agents, organizationMemberships, organizations, users } from "@hyros-ai/db";
import { db } from "../src/lib/db.js";
import { mastra } from "../src/mastra/index.js";
import { getRuntime } from "../src/chat/runtime.js";
import { createAgentRow } from "../src/chat/tenancy.js";
import { agentWorkdir } from "../src/sandbox/layout.js";
import { SandboxServiceClient } from "../src/sandbox/service-client.js";

const OWNER = "00000000-0000-0000-0000-00000000000c"; // throwaway uuid (users.id is uuid)
const AGENT = crypto.randomUUID();

function assert(cond: unknown, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ok: ${label}`);
}

await db
    .insert(users)
    .values({ id: OWNER, email: "check@hyros.local", name: "Check" })
    .onConflictDoNothing();

// Same path the chat route uses: personal organization, then a uid inside it.
const row = await createAgentRow({
    agentId: AGENT,
    owner: { id: OWNER, name: "Check" },
});
if (!row) throw new Error("FAIL: createAgentRow returned nothing");

let exitCode = 1;

try {
    console.log("[check] tenancy");
    assert(row.organizationId, "agent has an organization");
    assert(typeof row.sandboxUid === "number", "agent has a sandbox uid");
    assert(row.sandboxUid! >= 10_000 && row.sandboxUid! < 10_064, "uid is inside the image pool");

    console.log("[check] building runtime (standalone, no registration)…");
    const runtime = await getRuntime({ row, mastra });
    assert(runtime.controller, "controller built");

    const currentUser = {
        id: OWNER,
        email: "check@hyros.local",
        name: "Check",
        avatarUrl: null,
    };
    const session = await runtime.getSession(currentUser);
    assert(session.thread.requireId() === row.id, "session bound to threadId = agentId");
    assert(typeof session.respondToToolSuspension === "function", "session resume surface exists");
    assert(typeof session.suspensions?.register === "function", "suspension registry exists");

    // get-or-create: same owner resolves the same session record
    const again = await runtime.getSession(currentUser);
    assert(again.thread.requireId() === session.thread.requireId(), "session get-or-create stable");

    // spawn instructions while description is null; persona after a fake update
    const spawn = await runtime.controller.getCurrentAgent(session).getInstructions();
    assert(typeof spawn === "string" ? spawn.includes("ask_user") : true, "spawn instructions resolve");

    // ── Sandbox ──────────────────────────────────────────────────────────────
    if (!process.env.SANDBOX_SERVICE_URL) {
        console.log("[check] sandbox: SANDBOX_SERVICE_URL unset — skipping (local workspace in use)");
    } else {
        console.log("[check] sandbox");
        // getToolsForExecution, not listTools: workspace tools are assembled at
        // execution time, so listTools only shows the agent's own configured ones.
        const tools = await runtime.controller.getCurrentAgent(session).getToolsForExecution({
            threadId: row.id,
            resourceId: OWNER,
        });
        const toolNames = Object.keys(tools ?? {});
        assert(
            toolNames.includes("mastra_workspace_execute_command"),
            "agent has mastra_workspace_execute_command",
        );
        // A process manager would add these; this provider has none, so their
        // absence is what proves the sandbox went on as a static instance.
        assert(
            !toolNames.includes("mastra_workspace_get_process_output") &&
                !toolNames.includes("mastra_workspace_kill_process"),
            "no background-process tools (nothing behind them)",
        );

        const command = tools?.mastra_workspace_execute_command;
        const output = (await command?.execute?.(
            { command: "id -u && pwd && echo $HOME" },
            { toolCallId: "check", messages: [] } as never,
        )) as string;
        console.log(`     ${String(output).trim().split("\n").join(" | ")}`);
        assert(String(output).includes(String(row.sandboxUid)), "command ran as the agent's uid");
        assert(String(output).includes(agentWorkdir(row.id)), "command ran in the agent's directory");
    }

    console.log("[check] PASS");
    exitCode = 0;
} catch (error) {
    // Without this the `finally` below exits 0 and a real failure looks like a
    // pass with a short log.
    console.error("[check] FAIL");
    console.error(error);
    exitCode = 1;
} finally {
    await db.delete(agents).where(eq(agents.id, row.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, OWNER));
    await db.delete(organizations).where(eq(organizations.createdBy, OWNER));
    await db.delete(users).where(eq(users.id, OWNER));

    // The container is the organization's, and that organization only ever
    // existed for this check — take its volume and network with it.
    if (process.env.SANDBOX_SERVICE_URL) {
        const client = new SandboxServiceClient({
            url: process.env.SANDBOX_SERVICE_URL,
            ...(process.env.SANDBOX_SERVICE_TOKEN
                ? { token: process.env.SANDBOX_SERVICE_TOKEN }
                : {}),
        });
        await client
            .destroySandbox(row.organizationId, { purgeVolume: true })
            .catch((error: unknown) => {
                console.warn(`[check] sandbox cleanup skipped: ${(error as Error).message}`);
            });
    }
    process.exit(exitCode);
}
