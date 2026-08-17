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
import { execFileSync } from "node:child_process";

import { eq } from "drizzle-orm";

import { agents, organizationMemberships, organizations, users } from "@hyros-ai/db";
import { db } from "../src/lib/db.js";
import { mastra } from "../src/mastra/index.js";
import { getRuntime } from "../src/chat/runtime.js";
import { createAgentRow } from "../src/chat/tenancy.js";
import { agentWorkdir, SHARED_SKILLS_DIR } from "../src/sandbox/layout.js";
import { SandboxServiceClient } from "../src/sandbox/service-client.js";

/** The service client, for the checks that talk to it directly. */
function sandboxClient(): SandboxServiceClient {
    return new SandboxServiceClient({
        url: process.env.SANDBOX_SERVICE_URL!,
        ...(process.env.SANDBOX_SERVICE_TOKEN ? { token: process.env.SANDBOX_SERVICE_TOKEN } : {}),
    });
}

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

        // ── Skills ───────────────────────────────────────────────────────────
        console.log("[check] skills");
        const currentAgent = runtime.controller.getCurrentAgent(session);

        const skillToolNames = toolNames.filter((name) => name.includes("skill"));
        assert(skillToolNames.length > 0, `skill tools registered (${skillToolNames.join(", ")})`);

        const shipped = await currentAgent.listSkills();
        assert(
            shipped.some((skill) => skill.name === "csv-summary") &&
                shipped.some((skill) => skill.name === "pdf-text-extract"),
            "shipped skills reach the agent",
        );

        // The agent installs one for itself, with the shell it already has — the
        // real self-install path, not a privileged shortcut.
        await command?.execute?.(
            {
                command:
                    "mkdir -p skills/invoice-parse && " +
                    "printf '%s\\n' '---' 'name: invoice-parse' " +
                    "'description: Pull line items out of a supplier invoice.' '---' '' " +
                    "'# Invoice parsing' 'Use extract_tables, not extract_text.' " +
                    "> skills/invoice-parse/SKILL.md",
            },
            { toolCallId: "check-install", messages: [] } as never,
        );

        // An agent must not be able to install one for the whole organization.
        const escalation = (await command?.execute?.(
            { command: `mkdir -p ${SHARED_SKILLS_DIR}/not-allowed && echo wrote || echo refused` },
            { toolCallId: "check-escalate", messages: [] } as never,
        )) as string;
        assert(
            !String(escalation).includes("wrote"),
            "an agent cannot install an org-wide skill",
        );

        // The operator path: root inside the organization's container. `.shared`
        // is root-owned, which is exactly what makes it un-writable by agents.
        const info = await sandboxClient().getSandbox(row.organizationId);
        execFileSync("docker", [
            "exec",
            "-u",
            "0",
            info.containerName,
            "sh",
            "-c",
            `mkdir -p '${SHARED_SKILLS_DIR}/house-style' && ` +
                `printf '%s\\n' '---' 'name: house-style' ` +
                `'description: The organization house style for written output.' '---' '' ` +
                `'# House style' 'Short sentences. No exclamation marks.' ` +
                `> '${SHARED_SKILLS_DIR}/house-style/SKILL.md'`,
        ]);

        // Discovery ran when the runtime was built, before either skill existed.
        // `maybeRefresh` is what re-scans, and Mastra calls it before every agent
        // turn — so this is the same path a real turn takes, not a shortcut. It
        // will not look again within its 2s cooldown, which is why a skill an
        // agent installs lands on its next turn rather than that one.
        await new Promise((resolve) => setTimeout(resolve, 2_100));
        await (await currentAgent.getWorkspace())?.skills?.maybeRefresh();

        const discovered = await currentAgent.listSkills();
        console.log(`     ${discovered.map((skill) => skill.name).join(", ")}`);
        assert(
            discovered.some((skill) => skill.name === "invoice-parse"),
            "a skill the agent installed itself is discovered",
        );
        assert(
            discovered.some((skill) => skill.name === "house-style"),
            "an org-wide skill in .shared is discovered",
        );
        assert(
            discovered.some((skill) => skill.name === "csv-summary"),
            "shipped skills survive the merge with the container's",
        );
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
        await sandboxClient()
            .destroySandbox(row.organizationId, { purgeVolume: true })
            .catch((error: unknown) => {
                console.warn(`[check] sandbox cleanup skipped: ${(error as Error).message}`);
            });
    }
    process.exit(exitCode);
}
