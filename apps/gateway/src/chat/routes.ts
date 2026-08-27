/**
 * Chat routes — the single custom chat surface for user-created agents.
 *
 * POST /chat                 — fire-and-forget: validates + sets up the run,
 *                              kicks it, returns 200 with an empty body. Run
 *                              output does NOT come back here.
 * GET  /chat/:agentId/events — the SSE surface every client (web/desktop/mobile
 *                              zustand store) subscribes to: session info, a
 *                              displayState snapshot, then live run events.
 * PATCH /agents/:agentId/archive — soft-archive an owned agent.
 *
 * Run semantics (POST): if a run is parked on an ask_user suspension the
 * message is delivered as the ANSWER (native session resume); a live run is
 * steered; otherwise a fresh sendMessage starts a run. `isNew` requires a
 * client-generated uuid `agentId` so the 200-empty response never has to carry
 * the new id (and retries are idempotent via onConflictDoNothing).
 *
 * Events: session · snapshot · message · ask_user · done · error · heartbeat.
 */

import { Elysia, t } from "elysia";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { MastraDBMessage } from "@mastra/core/agent";

import type { AgentScheduleSummary, ChatMessageDto, ChatQuestion } from "@hyros-ai/domain";
import { agents, users } from "@hyros-ai/db";
import { authGuard, type AuthUser } from "../auth/guard.js";
import { isWireWorthy, toChatMessage, toChatMessages } from "../lib/chat-message.js";
import { db } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { messageText } from "../lib/message-text.js";
import { mastra } from "../mastra/index.js";
import { driveRun } from "./drive.js";
import { getRuntime, type ChatSession } from "./runtime.js";
import { createRuntimeContext, type HyrosRuntimeContext } from "./runtime-context.js";
import { deleteAllAgentSchedules, listAgentSchedules } from "./schedule-service.js";
import { createAgentRow } from "./tenancy.js";

const log = createLogger("chat");

const SSE_HEADERS = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
} as const;

/** Live SSE connection count per agent (diagnostics). */
const sseConnections = new Map<string, number>();

const TRACE_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;

type AgentRow = typeof agents.$inferSelect;
type AgentListDatabaseRow = Pick<
    AgentRow,
    "id" | "name" | "description" | "avatarUrl"
> & {
    createdAt: AgentRow["createdAt"] | string;
    lastRole: MastraDBMessage["role"] | null;
    lastContent: MastraDBMessage["content"] | null;
    lastAt: Date | string | null;
};

/** Gateway-owned SSE payload contract consumed by every chat client. */
export interface ChatEventMap {
    session: { agentId: AgentRow["id"]; threadId: string };
    snapshot: { running: boolean; pendingQuestion: ChatQuestion | null };
    message: { message: ChatMessageDto };
    ask_user: ChatQuestion;
    done: { reason: "complete" | "aborted" | "error" | "suspended" | null };
    error: { message: string };
}

export type ChatEvent = {
    [Type in keyof ChatEventMap]: { type: Type } & ChatEventMap[Type];
}[keyof ChatEventMap];

function requestTraceId(request: Request): string {
    const url = new URL(request.url);
    const candidate =
        request.headers.get("x-hyros-trace-id") ?? url.searchParams.get("traceId");
    return candidate && TRACE_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
}

function messageRole(role: string | null): "agent" | "user" {
    return role === "assistant" ? "agent" : "user";
}

type Emit = <Type extends keyof ChatEventMap>(
    type: Type,
    data: ChatEventMap[Type],
) => void;

/**
 * A message another agent sent into this thread, as opposed to any other Mastra
 * signal (a user message arrives as one too).
 *
 * Worth forwarding because the thread shows it as the quote above whatever the
 * agent says next. Converted, it carries no text part — only the signal envelope
 * — so it can never be mistaken for something this agent said.
 */
function isIncomingAgentMessage(message: MastraDBMessage | undefined): boolean {
    if (message?.role !== "signal") return false;
    const content = message.content as { metadata?: { signal?: { tagName?: unknown } } } | undefined;
    return content?.metadata?.signal?.tagName === "agent-message";
}

/** Map the session event bus onto our wire events. Returns the unsubscribe fn. */
function forwardSessionEvents(session: ChatSession, emit: Emit): () => void {
    return session.subscribe((event) => {
        switch (event.type) {
            // An assistant turn streams in through updates; an agent message is
            // written once, so whichever event carries it is the one to forward.
            // The client upserts by id, so forwarding it twice is harmless.
            case "message_start":
            case "message_end":
            case "message_update": {
                const message = (event as { message?: MastraDBMessage }).message;
                const assistantTurn =
                    message?.role === "assistant" && event.type === "message_update";
                if (assistantTurn || isIncomingAgentMessage(message)) {
                    // Reasoning is stripped at the transport boundary; a turn
                    // that was only thinking has nothing left to show, so it
                    // is never emitted.
                    const dto = toChatMessage(message!);
                    if (isWireWorthy(dto)) emit("message", { message: dto });
                }
                break;
            }
            case "tool_suspended": {
                const suspended = event as {
                    toolCallId?: string;
                    suspendPayload?: {
                        question?: string;
                        options?: { label: string; description?: string }[];
                        selectionMode?: "single_select" | "multi_select";
                    };
                };
                if (!suspended.toolCallId) break;
                emit("ask_user", {
                    toolCallId: suspended.toolCallId,
                    question: suspended.suspendPayload?.question ?? "",
                    options: suspended.suspendPayload?.options,
                    selectionMode: suspended.suspendPayload?.selectionMode,
                });
                break;
            }
            case "agent_end":
                // The reason is the UI's honesty hook: 'aborted' means the run
                // was steered away mid-turn, so clients can mark the partial
                // reply as cut short instead of a finished message.
                emit("done", { reason: event.reason ?? null });
                break;
            case "error":
                emit("error", {
                    message: (event as { error?: { message?: string } }).error?.message
                        ?? "agent run failed",
                });
                break;
        }
    });
}

/** Drive the run for an incoming user submission — see chat/drive.ts for the
 *  decision table (answer / steer / send / skip). */
async function drive(
    session: ChatSession,
    message: string,
    skip: boolean,
    requestContext: HyrosRuntimeContext,
): Promise<void> {
    await driveRun(session, {
        message,
        skip,
        requestContext,
        log,
    });
}

async function resolveRow(body: { agentId?: string; isNew?: boolean }, user: AuthUser) {
    if (body.isNew) {
        // Client generates the uuid (POST returns 200-empty, so the id must be
        // known to the caller). Both inserts are idempotent, so a retry is safe.
        await db
            .insert(users)
            .values({ id: user.id, email: user.email, name: user.name })
            .onConflictDoNothing();
        // createAgentRow owns the row's tenancy — the organization whose sandbox
        // it runs in, and its uid inside that container.
        return createAgentRow({
            agentId: body.agentId!,
            owner: { id: user.id, name: user.name },
        });
    }
    return db.query.agents.findFirst({
        where: and(
            eq(agents.id, body.agentId!),
            eq(agents.ownerId, user.id),
            isNull(agents.archivedAt),
        ),
    });
}

export const chatRoutes = new Elysia({ name: "chat" })
    .use(authGuard)
    .post(
        "/chat",
        async ({ body, user, status, request }) => {
            const ownerId = (user as AuthUser).id;
            const traceId = requestTraceId(request);
            const t0 = performance.now();
            log.info("[CHAT-TRACE] POST received", {
                traceId,
                owner: ownerId.slice(0, 8),
                isNew: body.isNew,
                agentId: body.agentId,
                messageLen: body.message?.length ?? 0,
            });
            try {
                if (body.isNew && !body.agentId) {
                    return status(400, {
                        error: "isNew requires a client-generated uuid agentId",
                    });
                }
                const row = await resolveRow(body, user as AuthUser);
                if (!row) {
                    log.warn("[CHAT-TRACE] POST agent missing", {
                        traceId,
                        owner: ownerId.slice(0, 8),
                        agentId: body.agentId,
                    });
                    return status(404, { error: "agent not found" });
                }

                const currentUser = user as AuthUser;
                const runtime = await getRuntime({ row, mastra });
                const session = await runtime.getSession(currentUser);
                const requestContext = createRuntimeContext(row, currentUser);
                const message = body.message?.trim() || "Hello"; // kickoff when empty

                // Fire-and-forget: the run lives server-side; clients watch it via
                // GET /chat/:agentId/events. Errors land in the log + event bus.
                drive(session, message, body.skip === true, requestContext)
                    .then(() =>
                        log.info("[CHAT-TRACE] drive done", {
                            traceId,
                            agentId: row.id,
                            ms: Math.round(performance.now() - t0),
                        }),
                    )
                    .catch((e) =>
                        log.error("[CHAT-TRACE] drive failed", {
                            traceId,
                            agentId: row.id,
                            error: String(e),
                            stack: e instanceof Error ? e.stack : undefined,
                        }),
                    );
                log.info("[CHAT-TRACE] POST accepted empty", {
                    traceId,
                    agentId: row.id,
                    status: 200,
                    bytes: 0,
                    ms: Math.round(performance.now() - t0),
                });
                return new Response(null, {
                    status: 200,
                    headers: { "x-hyros-trace-id": traceId },
                });
            } catch (e) {
                log.error("[CHAT-TRACE] POST unhandled", {
                    traceId,
                    owner: ownerId.slice(0, 8),
                    error: String(e),
                    stack: e instanceof Error ? e.stack : undefined,
                });
                return status(500, { error: String(e) });
            }
        },
        {
            body: t.Object({
                agentId: t.Optional(t.String({ format: "uuid" })),
                message: t.Optional(t.String()),
                isNew: t.Optional(t.Boolean()),
                // Skip button: resolves the parked question as skipped. Never a
                // chat message — ignored when nothing is parked.
                skip: t.Optional(t.Boolean()),
            }),
        },
    )
    .get("/chat/:agentId/events", async ({ params, user, status, request }) => {
        const ownerId = (user as AuthUser).id;
        const traceId = requestTraceId(request);
        try {
            const row = await db.query.agents.findFirst({
                where: and(
                    eq(agents.id, params.agentId),
                    eq(agents.ownerId, ownerId),
                    isNull(agents.archivedAt),
                ),
            });
            if (!row) {
                log.warn("[CHAT-TRACE] SSE agent missing", {
                    traceId,
                    owner: ownerId.slice(0, 8),
                    agentId: params.agentId,
                });
                return status(404, { error: "agent not found" });
            }

            const runtime = await getRuntime({ row, mastra });
            const session = await runtime.getSession(user as AuthUser);
            const live = (sseConnections.get(params.agentId) ?? 0) + 1;
            sseConnections.set(params.agentId, live);
            log.info("[CHAT-TRACE] SSE attach", {
                traceId,
                agentId: params.agentId,
                active: live,
                owner: ownerId.slice(0, 8),
            });

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const emit: Emit = (type, data) => {
                    log.info("[CHAT-TRACE] SSE emit", {
                        traceId,
                        agentId: row.id,
                        event: type,
                    });
                    controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`),
                    );
                };
                emit("session", { agentId: row.id, threadId: session.thread.requireId() });
                // displayState uses Maps (don't JSON-serialize) — project the
                // two things the UI hydrates from: running + a parked question.
                const ds = session.displayState.get() as {
                    isRunning?: boolean;
                    pendingSuspensions?: Map<
                        string,
                        {
                            toolCallId: string;
                            suspendPayload?: {
                                question?: string;
                                options?: { label: string; description?: string }[];
                                selectionMode?: "single_select" | "multi_select";
                            };
                        }
                    >;
                };
                const parked = ds.pendingSuspensions?.values().next().value;
                emit("snapshot", {
                    running: ds.isRunning ?? false,
                    pendingQuestion: parked
                        ? {
                              toolCallId: parked.toolCallId,
                              question: parked.suspendPayload?.question ?? "",
                              options: parked.suspendPayload?.options,
                              selectionMode: parked.suspendPayload?.selectionMode,
                          }
                        : null,
                });
                const unsubscribe = forwardSessionEvents(session, emit);
                // Log error events the session emits (they also forward as "error" wire events).
                const errorProbe = session.subscribe((event) => {
                    if (event.type === "error") {
                        const error = (event as { error?: { name?: string; message?: string } })
                            .error;
                        log.error("[CHAT-TRACE] SSE session error", {
                            traceId,
                            agentId: row.id,
                            errorName: error?.name,
                            errorMessage: error?.message ?? "unknown session error",
                        });
                    }
                });
                // Keep proxies/browsers from killing idle SSE connections.
                const heartbeat = setInterval(
                    () => controller.enqueue(encoder.encode(": ping\n\n")),
                    25_000,
                );
                request.signal.addEventListener("abort", () => {
                    clearInterval(heartbeat);
                    unsubscribe();
                    errorProbe();
                    const remaining = (sseConnections.get(params.agentId) ?? 1) - 1;
                    if (remaining <= 0) sseConnections.delete(params.agentId);
                    else sseConnections.set(params.agentId, remaining);
                    log.info("[CHAT-TRACE] SSE closed", {
                        traceId,
                        agentId: row.id,
                        remaining,
                    });
                    controller.close();
                });
            },
        });
        return new Response(stream, { headers: SSE_HEADERS });
        } catch (e) {
            log.error("[CHAT-TRACE] SSE unhandled", {
                traceId,
                owner: ownerId.slice(0, 8),
                agentId: params.agentId,
                error: String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
            return status(500, { error: String(e) });
        }
    })
    // ── Chat list: the user's agents with their latest message ───────────────
    .get("/agents", async ({ user, status, request }) => {
        const userId = (user as AuthUser).id;
        const traceId = requestTraceId(request);
        const t0 = performance.now();
        try {
        // mastra_messages is Mastra-owned (not in the Drizzle schema) → raw SQL.
        const rows = await db.execute<AgentListDatabaseRow>(sql`
            select a.id, a.name, a.description,
                   a.avatar_url as "avatarUrl",
                   a.created_at as "createdAt",
                   m.role as "lastRole", m.content as "lastContent",
                   m."createdAt" as "lastAt"
            from agents a
            left join lateral (
                -- mastra stores createdAt as naive-UTC timestamp → reinterpret
                select role, content, "createdAt" at time zone 'UTC' as "createdAt"
                from mastra_messages
                where thread_id = a.id::text order by "createdAt" desc limit 1
            ) m on true
            where a.owner_id = ${userId} and a.archived_at is null
            order by coalesce(m."createdAt", a.created_at) desc
        `);
        const result = rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            avatarUrl: r.avatarUrl,
            createdAt: new Date(r.createdAt).toISOString(),
            lastMessage: r.lastAt
                ? {
                      text: messageText(r.lastContent).slice(0, 140),
                      role: messageRole(r.lastRole),
                      createdAt: new Date(r.lastAt).toISOString(),
                  }
                : null,
        }));
        log.info("[CHAT-TRACE] agents response", {
            traceId,
            owner: userId.slice(0, 8),
            count: result.length,
            ms: Math.round(performance.now() - t0),
        });
        return result;
        } catch (e) {
            log.error("[CHAT-TRACE] agents unhandled", {
                traceId,
                owner: userId.slice(0, 8),
                error: String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
            return status(500, { error: String(e) });
        }
    })
    // ── Read-only schedule list for the agent detail panel ─────────────────
    .get(
        "/agents/:agentId/schedules",
        async ({ params, user, status }) => {
            const ownerId = (user as AuthUser).id;
            const row = await db.query.agents.findFirst({
                where: and(
                    eq(agents.id, params.agentId),
                    eq(agents.ownerId, ownerId),
                    isNull(agents.archivedAt),
                ),
            });
            if (!row) return status(404, { error: "agent not found" });
            try {
                const schedules: AgentScheduleSummary[] = await listAgentSchedules(mastra, {
                    agentId: row.id,
                    ownerId,
                });
                return schedules;
            } catch (error) {
                log.error("schedule list failed", {
                    agentId: row.id,
                    owner: ownerId.slice(0, 8),
                    error: String(error),
                });
                return status(500, { error: "could not load schedules" });
            }
        },
        { params: t.Object({ agentId: t.String({ format: "uuid" }) }) },
    )
    // ── Archive agent: delete schedules, retain profile + message history ───
    .patch(
        "/agents/:agentId/archive",
        async ({ params, user, status, request }) => {
            const ownerId = (user as AuthUser).id;
            const traceId = requestTraceId(request);
            const archivedAt = new Date();
            try {
                const owned = await db.query.agents.findFirst({
                    where: and(
                        eq(agents.id, params.agentId),
                        eq(agents.ownerId, ownerId),
                        isNull(agents.archivedAt),
                    ),
                });
                if (!owned) return status(404, { error: "agent not found" });
                const deletedSchedules = await deleteAllAgentSchedules(mastra, {
                    agentId: owned.id,
                    ownerId,
                });
                const [archived] = await db
                    .update(agents)
                    .set({ archivedAt, updatedAt: archivedAt })
                    .where(
                        and(
                            eq(agents.id, params.agentId),
                            eq(agents.ownerId, ownerId),
                            isNull(agents.archivedAt),
                        ),
                    )
                    .returning({ id: agents.id, archivedAt: agents.archivedAt });
                if (!archived?.archivedAt) {
                    log.warn("[CHAT-TRACE] archive agent missing", {
                        traceId,
                        owner: ownerId.slice(0, 8),
                        agentId: params.agentId,
                    });
                    return status(404, { error: "agent not found" });
                }
                const result = {
                    id: archived.id,
                    archivedAt: archived.archivedAt.toISOString(),
                };
                log.info("[CHAT-TRACE] agent archived", {
                    traceId,
                    owner: ownerId.slice(0, 8),
                    agentId: archived.id,
                    deletedSchedules,
                });
                return result;
            } catch (e) {
                log.error("[CHAT-TRACE] archive unhandled", {
                    traceId,
                    owner: ownerId.slice(0, 8),
                    agentId: params.agentId,
                    error: String(e),
                    stack: e instanceof Error ? e.stack : undefined,
                });
                return status(500, { error: String(e) });
            }
        },
        {
            params: t.Object({ agentId: t.String({ format: "uuid" }) }),
        },
    )
    // ── Thread history (reattach / reopen): persisted messages for one agent ──
    .get("/chat/:agentId/messages", async ({ params, user, status, request }) => {
        const ownerId = (user as AuthUser).id;
        const traceId = requestTraceId(request);
        const t0 = performance.now();
        try {
            const row = await db.query.agents.findFirst({
                where: and(
                    eq(agents.id, params.agentId),
                    eq(agents.ownerId, ownerId),
                    isNull(agents.archivedAt),
                ),
            });
            if (!row) {
                log.warn("[CHAT-TRACE] history agent missing", {
                    traceId,
                    owner: ownerId.slice(0, 8),
                    agentId: params.agentId,
                });
                return status(404, { error: "agent not found" });
            }
            const runtime = await getRuntime({ row, mastra });
            const session = await runtime.getSession(user as AuthUser);
            const stored = await session.thread.listMessages({ threadId: row.id, limit: 200 });
            const messages: ChatMessageDto[] = toChatMessages(stored ?? []).filter(isWireWorthy);
            log.info("[CHAT-TRACE] history response", {
                traceId,
                agentId: params.agentId,
                count: messages.length,
                ms: Math.round(performance.now() - t0),
            });
            return messages;
        } catch (e) {
            log.error("[CHAT-TRACE] history unhandled", {
                traceId,
                owner: ownerId.slice(0, 8),
                agentId: params.agentId,
                error: String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
            return status(500, { error: String(e) });
        }
    });
