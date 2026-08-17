import type { AgentSignal } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { slugifyAgentName } from "./agent-slug.js";
import {
    createRuntimeContext,
    readRuntimeIdentity,
    type CurrentAgentContext,
    type CurrentUserContext,
    type HyrosRuntimeContext,
} from "./runtime-context.js";
import type { AgentRow, ChatSession } from "./runtime.js";

export const SEND_AGENT_MESSAGE_TOOL_NAME = "sendAgentMessage";
const MAX_AGENT_PROMPT_LENGTH = 20_000;

type SignalAction = "wake" | "deliver" | "persist" | "discard" | "blocked";
type DeliveryAction = SignalAction | "unknown";

/** The parts of a target's chat session agent messaging depends on. */
export interface AgentMessageTargetSession {
    sendSignal: ChatSession["sendSignal"];
    approval: { isArmed(): boolean };
    suspensions: { hasPending(): boolean };
}

export interface AgentMessageTarget {
    row: AgentRow;
    session: AgentMessageTargetSession;
}

/**
 * A signal sent onto a live run counts as a user interruption in Mastra: it
 * declines whatever approval is parked on that run. A parked ask_user
 * suspension is the target's own conversation waiting on its owner. In both
 * cases the target is mid-exchange with the user, so an agent message must not
 * be delivered — mirrors the scheduled-prompt guard in the schedule workflow.
 */
function isAwaitingUser(session: AgentMessageTargetSession): boolean {
    return session.approval.isArmed() || session.suspensions.hasPending();
}

export interface AgentMessageToolDependencies {
    sourceAgentId: string;
    resolveTarget(input: {
        targetAgentSlug: string;
        currentUser: CurrentUserContext;
    }): Promise<AgentMessageTarget | null>;
    resolveReplyTarget(input: {
        inReplyTo: string;
        currentAgent: CurrentAgentContext;
        currentUser: CurrentUserContext;
    }): Promise<AgentMessageTarget | null>;
    createId?: () => string;
}

export type SendAgentPromptInput =
    | {
          kind: "message";
          targetAgentName: string;
          prompt: string;
          replyMode: "required" | "none";
      }
    | {
          kind: "reply";
          inReplyTo: string;
          prompt: string;
      };

export type AgentMessageResultCode =
    | "DELIVERED"
    | "TARGET_NOT_FOUND"
    | "INVALID_REPLY"
    | "SELF_TARGET"
    | "TARGET_AWAITING_USER"
    | "DELIVERY_NOT_ACCEPTED";

export interface SendAgentPromptResult {
    delivered: boolean;
    code: AgentMessageResultCode;
    message: string;
    messageId?: string;
    targetAgentSlug?: string;
    targetAgentName?: string;
    action?: DeliveryAction;
    runId?: string;
    inReplyTo?: string;
}

function parseMessageContent(content: unknown): Record<string, unknown> | null {
    if (typeof content === "string") {
        try {
            return parseMessageContent(JSON.parse(content));
        } catch {
            return null;
        }
    }
    return content && typeof content === "object"
        ? (content as Record<string, unknown>)
        : null;
}

/**
 * Messages delivered with a reply requested, still unanswered.
 *
 * A reply has to be verified against the message it answers, and the durable copy
 * of that message is not available in time: Mastra writes the delivered signal to
 * storage after the run it wakes has already started, so an agent replying in that
 * run — the common case, and what the prompt asks it to do — finds nothing and its
 * reply is refused as unverifiable.
 *
 * This is the same fact recorded where it is already known: we sent the message, so
 * we know it is outstanding and who it belongs to. The persisted envelope stays the
 * durable path for a reply that comes later, or after a restart.
 */
interface OutstandingAgentMessage {
    fromAgentId: string;
    toAgentId: string;
    ownerId: string;
}

/** Bounded: a gateway that runs for weeks must not accumulate every message. */
const OUTSTANDING_LIMIT = 500;
const outstanding = new Map<string, OutstandingAgentMessage>();

function rememberOutstanding(messageId: string, entry: OutstandingAgentMessage): void {
    outstanding.set(messageId, entry);
    // Map iterates in insertion order, so the first key is the oldest.
    while (outstanding.size > OUTSTANDING_LIMIT) {
        const oldest = outstanding.keys().next();
        if (oldest.done) break;
        outstanding.delete(oldest.value);
    }
}

/**
 * The sender an in-flight reply belongs to, or null when this process has no
 * record of it.
 *
 * Applies the same authorization the persisted path does: only the agent that
 * received the message may reply to it, and only inside its own owner's directory.
 * Nothing here comes from the model beyond the id it named.
 */
export function outstandingReplyTarget(
    inReplyTo: string,
    currentAgentId: string,
    ownerId: string,
): string | null {
    const entry = outstanding.get(inReplyTo);
    if (!entry) return null;
    if (entry.toAgentId !== currentAgentId || entry.ownerId !== ownerId) return null;
    return entry.fromAgentId;
}

/** Resolve the sender UUID from a persisted, verified Mastra signal envelope. */
export function replyTargetAgentIdFromSignalContent(
    content: unknown,
    input: { inReplyTo: string; currentAgentId: string },
): string | null {
    const envelope = parseMessageContent(content);
    const envelopeMetadata = parseMessageContent(envelope?.metadata);
    const signal = parseMessageContent(envelopeMetadata?.signal);
    const attributes = parseMessageContent(signal?.attributes);
    const metadata = parseMessageContent(signal?.metadata);

    if (
        signal?.id !== input.inReplyTo ||
        signal.tagName !== "agent-message" ||
        attributes?.messageId !== input.inReplyTo ||
        attributes.expectsReply !== true ||
        metadata?.protocol !== "hyros-agent-message-v1" ||
        metadata.messageId !== input.inReplyTo ||
        metadata.targetAgentId !== input.currentAgentId ||
        metadata.expectsReply !== true ||
        typeof metadata.replyToAgentId !== "string"
    ) {
        return null;
    }
    return metadata.replyToAgentId;
}

function failure(
    code: Exclude<AgentMessageResultCode, "DELIVERED" | "DELIVERY_NOT_ACCEPTED">,
    message: string,
    extra: Partial<SendAgentPromptResult> = {},
): SendAgentPromptResult {
    return { delivered: false, code, message, ...extra };
}

function buildSignal(input: {
    id: string;
    prompt: string;
    source: CurrentAgentContext;
    targetAgentId: string;
    expectsReply: boolean;
    inReplyTo?: string;
}): AgentSignal {
    return {
        id: input.id,
        type: "notification",
        tagName: "agent-message",
        contents: input.prompt,
        attributes: {
            messageId: input.id,
            replyToAgentName: input.source.name,
            expectsReply: input.expectsReply,
            ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        },
        metadata: {
            protocol: "hyros-agent-message-v1",
            messageId: input.id,
            // Persisted only for trusted reply correlation. It is deliberately
            // absent from the model-visible signal attributes.
            replyToAgentId: input.source.id,
            targetAgentId: input.targetAgentId,
            expectsReply: input.expectsReply,
            ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        },
    };
}

export async function sendAgentPrompt(
    input: SendAgentPromptInput,
    requestContext: HyrosRuntimeContext,
    dependencies: AgentMessageToolDependencies,
): Promise<SendAgentPromptResult> {
    const { currentAgent, currentUser } = readRuntimeIdentity(
        requestContext,
        dependencies.sourceAgentId,
    );

    let target: AgentMessageTarget | null;
    let targetAgentSlug: string | undefined;
    let expectsReply = false;
    let inReplyTo: string | undefined;

    if (input.kind === "message") {
        targetAgentSlug = slugifyAgentName(input.targetAgentName);
        if (!targetAgentSlug) {
            return failure(
                "TARGET_NOT_FOUND",
                `No active agent named ${JSON.stringify(input.targetAgentName)} exists in the current user's directory. No message was sent.`,
            );
        }
        if (currentAgent.slug && targetAgentSlug === currentAgent.slug) {
            return failure(
                "SELF_TARGET",
                "An agent cannot send a message to itself. No message was sent.",
                { targetAgentSlug },
            );
        }
        target = await dependencies.resolveTarget({
            targetAgentSlug,
            currentUser,
        });
        expectsReply = input.replyMode === "required";
    } else {
        inReplyTo = input.inReplyTo;
        target = await dependencies.resolveReplyTarget({
            inReplyTo,
            currentAgent,
            currentUser,
        });
    }

    if (!target || !target.row.description) {
        return failure(
            input.kind === "reply" ? "INVALID_REPLY" : "TARGET_NOT_FOUND",
            input.kind === "reply"
                ? "The original agent message could not be verified, so no reply was sent."
                : `No active, fully onboarded agent named ${JSON.stringify(input.targetAgentName)} exists in the current user's directory. No message was sent.`,
            {
                ...(targetAgentSlug ? { targetAgentSlug } : {}),
                ...(inReplyTo ? { inReplyTo } : {}),
            },
        );
    }
    if (target.row.id === currentAgent.id) {
        return failure(
            "SELF_TARGET",
            "An agent cannot send a message to itself. No message was sent.",
            { targetAgentSlug: target.row.slug ?? slugifyAgentName(target.row.name) },
        );
    }

    const canonicalSlug = target.row.slug ?? slugifyAgentName(target.row.name);
    if (isAwaitingUser(target.session)) {
        return failure(
            "TARGET_AWAITING_USER",
            `${target.row.name} is waiting on an answer from your user right now, so no message was sent. Try again later, or tell your user what you needed.`,
            { targetAgentSlug: canonicalSlug, ...(inReplyTo ? { inReplyTo } : {}) },
        );
    }

    const messageId = (dependencies.createId ?? (() => crypto.randomUUID()))();
    const signal = buildSignal({
        id: messageId,
        prompt: input.prompt,
        source: currentAgent,
        targetAgentId: target.row.id,
        expectsReply,
        ...(inReplyTo ? { inReplyTo } : {}),
    });
    const targetContext = createRuntimeContext(target.row, currentUser);
    const delivery = target.session.sendSignal(signal, {
        requestContext: targetContext,
        requireDelivery: true,
    });
    const accepted = await delivery.accepted;
    // An absent action means Mastra never reported a routing decision. Treat it
    // as undelivered: the tool contract forbids claiming a send we can't confirm.
    const action = accepted.action ?? "unknown";
    const delivered = action === "wake" || action === "deliver";

    if (delivered && expectsReply) {
        // Recorded before the target can answer: its reply arrives in the run this
        // delivery just woke, before the signal reaches storage.
        rememberOutstanding(messageId, {
            fromAgentId: currentAgent.id,
            toAgentId: target.row.id,
            ownerId: currentUser.id,
        });
    }

    return {
        delivered,
        code: delivered ? "DELIVERED" : "DELIVERY_NOT_ACCEPTED",
        message: delivered
            ? `Message delivered to ${target.row.name}.`
            : `Delivery to ${target.row.name} was not accepted.`,
        messageId,
        targetAgentSlug: canonicalSlug,
        targetAgentName: target.row.name,
        action,
        ...(accepted.runId ? { runId: accepted.runId } : {}),
        ...(inReplyTo ? { inReplyTo } : {}),
    };
}

const resultSchema = z.object({
    delivered: z.boolean(),
    code: z.enum([
        "DELIVERED",
        "TARGET_NOT_FOUND",
        "INVALID_REPLY",
        "SELF_TARGET",
        "TARGET_AWAITING_USER",
        "DELIVERY_NOT_ACCEPTED",
    ]),
    message: z.string(),
    messageId: z.string().optional(),
    targetAgentSlug: z.string().optional(),
    targetAgentName: z.string().optional(),
    action: z
        .enum(["wake", "deliver", "persist", "discard", "blocked", "unknown"])
        .optional(),
    runId: z.string().optional(),
    inReplyTo: z.string().optional(),
});

export function buildSendAgentMessageTool(dependencies: AgentMessageToolDependencies) {
    return createTool({
        id: "send_agent_message",
        description:
            "Send one asynchronous Mastra signal to another active agent belonging to the current user. " +
            "For a new message, copy the target's exact display name from the agent directory, provide a complete prompt, and explicitly choose whether a reply is required. " +
            "For a reply to an incoming agent-message, provide only its messageId as inReplyTo; the server resolves the recipient from that trusted original signal. " +
            "The result is authoritative: never say a message was sent unless delivered=true, and never substitute or guess another agent when the requested target is not found. " +
            "A TARGET_AWAITING_USER result means the recipient is mid-conversation with your user: report that to your user instead of retrying in a loop.",
        inputSchema: z.discriminatedUnion("kind", [
            z.object({
                kind: z.literal("message"),
                targetAgentName: z.string().trim().min(1),
                prompt: z.string().trim().min(1).max(MAX_AGENT_PROMPT_LENGTH),
                replyMode: z.enum(["required", "none"]),
            }),
            z.object({
                kind: z.literal("reply"),
                inReplyTo: z.string().min(1),
                prompt: z.string().trim().min(1).max(MAX_AGENT_PROMPT_LENGTH),
            }),
        ]),
        outputSchema: resultSchema,
        execute: (input, { requestContext }) =>
            sendAgentPrompt(
                input,
                requestContext as HyrosRuntimeContext,
                dependencies,
            ),
    });
}
