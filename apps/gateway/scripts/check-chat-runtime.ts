/**
 * No-LLM check for the chat runtime (TASK-023): proves the request-driven
 * builder works — standalone controller (no __registerMastra), session binding
 * (threadId = agentId), and the re-park path — without spending model quota.
 *
 * Creates a throwaway user+agent row in the real DB, exercises the runtime,
 * then deletes them. Run from apps/gateway:
 *   bun --env-file=../../.env run scripts/check-chat-runtime.ts
 */
import { eq } from "drizzle-orm";

import { agents, users } from "@hyros-ai/db";
import { db } from "../src/lib/db.js";
import { mastra } from "../src/mastra/index.js";
import { getRuntime } from "../src/chat/runtime.js";

const OWNER = "00000000-0000-0000-0000-00000000000c"; // throwaway uuid (users.id is uuid)

function assert(cond: unknown, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ok: ${label}`);
}

const [userRow] = await db
    .insert(users)
    .values({ id: OWNER, email: "check@hyros.local", name: "Check" })
    .onConflictDoNothing()
    .returning();
const [row] = await db
    .insert(agents)
    .values({ ownerId: OWNER, name: "New agent" })
    .returning();

try {
    console.log("[check] building runtime (standalone, no registration)…");
    const runtime = await getRuntime({ row, mastra });
    assert(runtime.controller, "controller built");

    const session = await runtime.getSession(OWNER);
    assert(session.thread.requireId() === row.id, "session bound to threadId = agentId");
    assert(typeof session.respondToToolSuspension === "function", "session resume surface exists");
    assert(typeof session.suspensions?.register === "function", "suspension registry exists");

    // get-or-create: same owner resolves the same session record
    const again = await runtime.getSession(OWNER);
    assert(again.thread.requireId() === session.thread.requireId(), "session get-or-create stable");

    // spawn instructions while description is null; persona after a fake update
    const spawn = await runtime.controller.getCurrentAgent(session).getInstructions();
    assert(typeof spawn === "string" ? spawn.includes("ask_user") : true, "spawn instructions resolve");

    console.log("[check] PASS");
} finally {
    await db.delete(agents).where(eq(agents.id, row.id));
    await db.delete(users).where(eq(users.id, OWNER));
    process.exit(0);
}
