import { describe, expect, test } from "bun:test";

import { driveRun, SKIP_ANSWER } from "./drive.js";

type AnySession = Record<string, unknown>;

interface FakeSuspensions {
    hasPending: () => boolean;
    resolveToolCallId: (toolCallId?: string) => string | undefined;
    has: (input: { toolCallId: string }) => boolean;
}

function fakeSession(overrides: {
    pendingToolCallId?: string;
    /** Remaining listMessages results, returned one per call. */
    latestMessages?: Array<Array<{ id: string; role: string }>>;
    /** Whether a run is live (drives the steer path). */
    live?: boolean;
    sendMessage?: () => Promise<void>;
}) {
    let parkedToolCallId = overrides.pendingToolCallId;
    const calls = {
        followUps: [] as Array<{ content: string }>,
        sendMessage: [] as Array<{ content: string }>,
        resume: [] as Array<{ toolCallId: string; resumeData: string; requestContext: unknown }>,
        emitted: [] as Array<{ type: string; errorType?: string }>,
    };
    let latestIndex = 0;
    const latest = () => {
        const queue = overrides.latestMessages ?? [[{ id: "m0", role: "user" }]];
        const result = queue[Math.min(latestIndex, queue.length - 1)]!;
        latestIndex += 1;
        return result;
    };
    const suspensions: FakeSuspensions = {
        hasPending: () => parkedToolCallId !== undefined,
        resolveToolCallId: () => parkedToolCallId,
        has: ({ toolCallId }) => toolCallId === parkedToolCallId,
    };
    const session = {
        id: "agent-1",
        suspensions,
        run: { isRunning: () => overrides.live === true },
        followUp: async (input: { content: string; requestContext: unknown }) => {
            calls.followUps.push({ content: input.content });
        },
        followUps: {
            enqueue: (followUp: { content: string }) => {
                calls.followUps.push(followUp);
            },
        },
        emit: (event: { type: string; errorType?: string }) => calls.emitted.push(event),
        thread: { listMessages: async () => latest() },
        sendMessage: async ({ content }: { content: string }) => {
            calls.sendMessage.push({ content });
            await overrides.sendMessage?.();
        },
        respondToToolSuspension: async (input: {
            toolCallId: string;
            resumeData: string;
            requestContext: unknown;
        }) => {
            calls.resume.push(input);
            // A real resume consumes the suspension.
            parkedToolCallId = undefined;
        },
    };
    return { session: session as unknown as AnySession, calls };
}

const log = {
    info: () => {},
    warn: () => {},
    error: () => {},
};
void log;

const base = {
    requestContext: {} as never,
    log: {
        info: () => {},
        warn: () => {},
        error: () => {},
    },
};

describe("driveRun", () => {
    test("idle → plain sendMessage", async () => {
        const { session, calls } = fakeSession({});
        await driveRun(session as never, { ...base, message: "hi" });
        expect(calls.sendMessage).toEqual([{ content: "hi" }]);
        expect(calls.followUps).toEqual([]);
    });

    test("pending suspension → message delivered as the answer, consumed", async () => {
        const { session, calls } = fakeSession({ pendingToolCallId: "call-1" });
        await driveRun(session as never, { ...base, message: "my answer" });
        expect(calls.resume).toHaveLength(1);
        expect(calls.resume[0]).toMatchObject({ toolCallId: "call-1", resumeData: "my answer" });
        expect(calls.emitted).toEqual([]);
        expect(calls.sendMessage).toEqual([]);
    });

    test("resume that silently no-ops surfaces a session error", async () => {
        // Simulate the phantom: the resume resolves but the question stays
        // parked — the answer never reached the run.
        const { session, calls } = fakeSession({ pendingToolCallId: "call-1" });
        (session as AnySession).respondToToolSuspension = async () => {}; // non-consuming
        await driveRun(session as never, { ...base, message: "my answer" });
        expect(calls.emitted).toMatchObject([
            { type: "error", errorType: "resume_not_delivered" },
        ]);
        expect(calls.sendMessage).toEqual([]);
    });

    test("skip without a parked question is a no-op, never a chat message", async () => {
        const { session, calls } = fakeSession({ sendMessage: async () => {} });
        (session as { run: { isRunning: () => boolean } }).run.isRunning = () => false;
        await driveRun(session as never, { ...base, message: "", skip: true });
        expect(calls.sendMessage).toEqual([]);
        expect(calls.resume).toEqual([]);
    });

    test("skip resolves the parked question with the fixed skip answer", async () => {
        const { session, calls } = fakeSession({ pendingToolCallId: "call-1" });
        await driveRun(session as never, { ...base, message: "", skip: true });
        expect(calls.resume).toHaveLength(1);
        expect(calls.resume[0]).toMatchObject({ toolCallId: "call-1", resumeData: SKIP_ANSWER });
        expect(calls.emitted).toEqual([]);
    });

    test("live run → waits for the turn to end, then sends persisted", async () => {
        let running = true;
        const { session, calls } = fakeSession({});
        (session as { run: { isRunning: () => boolean } }).run.isRunning = () => running;
        const send = driveRun(session as never, { ...base, message: "interrupt!" });
        running = false; // the turn ends while we wait
        await send;
        expect(calls.sendMessage).toEqual([{ content: "interrupt!" }]);
        expect(calls.followUps).toEqual([]);
        expect(calls.emitted).toEqual([]);
    });

    test("a question parked while waiting → the message becomes the answer", async () => {
        let running = true;
        const { session, calls } = fakeSession({ pendingToolCallId: "call-new" });
        (session as { run: { isRunning: () => boolean } }).run.isRunning = () => running;
        const send = driveRun(session as never, { ...base, message: "my steer" });
        running = false; // turn ended, question parked
        await send;
        expect(calls.resume[0]).toMatchObject({ toolCallId: "call-new", resumeData: "my steer" });
        expect(calls.sendMessage).toEqual([]);
    });

    test("turn still running after the cap → falls back to the engine queue", async () => {
        const { session, calls } = fakeSession({ live: true });
        await driveRun(session as never, { ...base, message: "interrupt!", steerWaitMs: 50 });
        expect(calls.sendMessage).toEqual([]);
        expect(calls.followUps).toEqual([{ content: "interrupt!" }]);
    });
});
