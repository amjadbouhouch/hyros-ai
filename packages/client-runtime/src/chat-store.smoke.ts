/**
 * Live smoke test for the chat store against a running gateway (needs
 * DEV_USER_ID set server-side). Exercises the full client flow:
 * createAgent (client uuid, 200-empty POST) → SSE attach → ask_user lands in
 * store state → answer → run completes.
 *
 *   bun run src/chat-store.smoke.ts   (from packages/client-runtime, gateway up)
 */
import { EventSource } from "eventsource";

import { createChatStore } from "./chat-store.js";

const BASE = process.env.GATEWAY_URL ?? "http://localhost:3000";

const chat = createChatStore({
    baseUrl: BASE,
    createEventSource: (url) => new EventSource(url) as never,
});

async function waitFor<T>(label: string, poll: () => T | undefined, ms = 120_000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = poll();
        if (v !== undefined) return v;
        if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
        await new Promise((r) => setTimeout(r, 250));
    }
}

const agentId = await chat.createAgent();
console.log("[smoke] created agent", agentId);

const q = await waitFor(
    "ask_user question",
    () => chat.store.getState().agents[agentId]?.pendingQuestion ?? undefined,
);
console.log("[smoke] pendingQuestion:", q.question);
console.log("[smoke] suggestions:", q.options?.map((option) => option.label).join(", "));
if (!q.options || q.options.length < 2) {
    throw new Error("ask_user did not provide at least two suggestions");
}

await chat.send(agentId, "You are Pixel — a playful UI copy assistant.");
console.log("[smoke] answered; waiting for next event…");

await waitFor(
    "interview continues (next question or done)",
    () => {
        const a = chat.store.getState().agents[agentId];
        return a && !a.running ? true : undefined;
    },
);
const state = chat.store.getState().agents[agentId]!;
console.log("[smoke] messages:", state.messages.length, "| running:", state.running);
console.log("[smoke] PASS");
process.exit(0);
