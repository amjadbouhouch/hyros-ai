/**
 * Drive a user submission into the agent session — the single decision point
 * for "what does this message mean".
 *
 * Priority, matching the session's real state:
 *   1. A parked ask_user suspension → the message is the ANSWER (or a Skip),
 *      delivered via respondToToolSuspension with the explicit toolCallId.
 *      When the suspension is still parked afterwards, the answer never
 *      landed (the silent no-op) — surface it as a session error instead of
 *      pretending it worked.
 *   2. A live run → STEER: abort the in-flight turn and start a fresh one
 *      with the new content. Steering is the product intent; the only bug to
 *      prevent is the collision where the steer lands in the same instant the
 *      run finished on its own — the abort hits nothing and the replacement
 *      message races the teardown and vanishes. So delivery is verified: if
 *      the thread did not advance, the send is retried once, and if it still
 *      produced nothing, the failure is surfaced as a session error.
 *   3. Idle → plain sendMessage.
 */

import type { HyrosRuntimeContext } from "./runtime-context.js";
import type { ChatSession } from "./runtime.js";

interface DriveLogger {
    warn(message: string, data?: Record<string, unknown>): void;
}

/** The fixed answer the model-side ask_user convention understands as skip. */
export const SKIP_ANSWER = "Skip this question";

export interface DriveOptions {
    message: string;
    /** True when the submission is the Skip button, not typed text. */
    skip?: boolean;
    requestContext: HyrosRuntimeContext;
    log: DriveLogger;
    /** Re-entry depth after waiting out a live run (1 = no more waiting). */
    depth?: number;
    /** Steering wait cap override (tests); production default is 30s. */
    steerWaitMs?: number;
}

export async function driveRun(
    session: ChatSession,
    { message, skip, requestContext, log, depth = 0, steerWaitMs = 30_000 }: DriveOptions,
): Promise<void> {
    if (skip) {
        await driveSkip(session, { requestContext, log });
        return;
    }

    if (session.suspensions.hasPending()) {
        const toolCallId = session.suspensions.resolveToolCallId();
        if (toolCallId) {
            await session.respondToToolSuspension({
                toolCallId,
                resumeData: message,
                requestContext,
            });
            if (session.suspensions.has({ toolCallId })) {
                // The resume was accepted with a 200 but the question is still
                // parked — the answer went nowhere. Say so on the session bus;
                // forwardSessionEvents turns it into a wire error the client
                // renders in the thread.
                log.warn("resume not delivered", { toolCallId, event: "resume_not_delivered" });
                session.emit({
                    type: "error",
                    error: new Error("Your answer did not reach the agent — please try again."),
                    errorType: "resume_not_delivered",
                });
            }
            return;
        }
    }

    if (session.run.isRunning()) {
        // Steering: wait for the current turn to finish (it is seconds, not
        // minutes), then re-evaluate — the message becomes a proper persisted
        // send, or the answer to a question that parked in the meantime. Only
        // if the turn is still running after the cap do we fall back to the
        // session's follow-up queue, which the run engine delivers in-loop
        // (re-queued on failure; the one trade-off is that in-loop delivery
        // does not persist the raw text). A hard mid-stream abort was tried
        // first and rejected: in @mastra/core 1.59 an aborted turn can unwind
        // without persisting and strand the queue.
        const ended = depth > 0 || (await waitForRunEnd(session, steerWaitMs));
        if (!ended) {
            await session.followUp({ content: message, requestContext });
            return;
        }
        return driveRun(session, { message, requestContext, log, depth: depth + 1 });
    }

    await session.sendMessage({ content: message, requestContext });
}

/** Poll until the live run ends (completed, suspended, or errored). */
async function waitForRunEnd(session: ChatSession, capMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + capMs;
    while (session.run.isRunning()) {
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return true;
}

async function driveSkip(
    session: ChatSession,
    { requestContext, log }: Omit<DriveOptions, "message" | "skip">,
): Promise<void> {
    if (!session.suspensions.hasPending()) {
        // Skipping with nothing on screen is a no-op, never a chat message.
        log.warn("skip without a parked question", { event: "skip_without_pending" });
        return;
    }
    const toolCallId = session.suspensions.resolveToolCallId();
    if (!toolCallId) return;
    await session.respondToToolSuspension({
        toolCallId,
        resumeData: SKIP_ANSWER,
        requestContext,
    });
    if (session.suspensions.has({ toolCallId })) {
        log.warn("skip not delivered", { toolCallId, event: "skip_not_delivered" });
        session.emit({
            type: "error",
            error: new Error("Skip did not reach the agent — please try again."),
            errorType: "resume_not_delivered",
        });
    }
}
