import type { ChatMessageDto, ChatMessagePart } from "@hyros-ai/domain";
import { trailingReasoningText } from "@hyros-ai/utils";

/** An ordinary bubble in the thread. */
export interface ChatMessageView {
    kind: "message";
    id: string;
    /**
     * Who is talking. `system` is neither the user nor the agent — a run that
     * failed, reported where it happened instead of leaving the thread to stop
     * mid-sentence.
     */
    role: "user" | "assistant" | "system";
    text: string;
    createdAt: string;
    /**
     * The agent's ask_user question this bubble answers, quoted above it so a
     * one-word answer still reads as a reply.
     */
    replyTo?: string;
    /** The run was steered away mid-turn — this reply is a partial. */
    interrupted?: boolean;
}

/** One message between this thread's agent and another. */
export interface PeerMessageView {
    id: string;
    /** Who wrote it: this thread's agent, or the other one. */
    author: "agent" | "peer";
    text: string;
    createdAt: string;
}

/**
 * One conversation with another agent: a message plus everything that replied to
 * it, however deep the chain runs.
 *
 * A chain, not a peer. Two messages nobody answered are two separate things to
 * say, and grouping them by peer claimed a conversation that never happened. The
 * protocol already correlates a reply with what it answers, so that correlation is
 * what defines a conversation here.
 *
 * The row sits where the chain's latest message landed, so a conversation that
 * keeps going follows the turn that prompted it down the thread.
 */
export interface PeerExchangeView {
    kind: "exchange";
    id: string;
    /** The other agent. Its id is known only for messages it sent us. */
    peer: { id: string | null; name: string };
    /** This conversation's messages, oldest first, both directions. */
    messages: PeerMessageView[];
    /** The message that opened the conversation. */
    createdAt: string;
    /** Its latest message — where the row sits in the thread. */
    updatedAt: string;
}

export type ChatThreadItem = ChatMessageView | PeerExchangeView;

export function messageCreatedAt(message: ChatMessageDto): string {
    return typeof message.metadata?.createdAt === "string"
        ? message.metadata.createdAt
        : new Date(0).toISOString();
}

function askUserAnswer(part: ChatMessagePart): string | null {
    if (part.type !== "tool-ask_user" || part.state !== "output-available") return null;
    const output = part.output;
    const content =
        typeof output === "string"
            ? output
            : output && typeof output === "object"
              ? (output as { content?: unknown }).content
              : null;
    if (typeof content !== "string") return null;
    return content.replace(/^User answered:\s*/i, "").trim() || null;
}

/** The question text an ask_user call asked, from its tool input. */
function askUserQuestion(part: ChatMessagePart): string | null {
    if (part.type !== "tool-ask_user") return null;
    const input = part.input;
    if (!input || typeof input !== "object") return null;
    const question = (input as { question?: unknown }).question;
    return typeof question === "string" && question.trim() ? question.trim() : null;
}

/** Question text per ask_user tool call, in any tool state. */
function questionsByToolCallId(messages: ChatMessageDto[]): Map<string, string> {
    const questions = new Map<string, string>();
    for (const message of messages) {
        for (const part of message.parts) {
            const question = askUserQuestion(part);
            if (question && part.toolCallId) questions.set(part.toolCallId, question);
        }
    }
    return questions;
}

// ── Agent-to-agent traffic ──────────────────────────────────────────────────
//
// A thread carries both directions of its own peer traffic, in two different
// shapes: what the agent sent is the tool call it made, and what it received is
// the signal delivered to it. So an exchange can be reconstructed from one
// thread alone — no cross-thread lookup.

/** Marks a signal as one of ours rather than any other Mastra notification. */
const AGENT_MESSAGE_PROTOCOL = "hyros-agent-message-v1";

interface PeerRef {
    id: string | null;
    name: string;
}

interface PeerMessageDraft extends PeerMessageView {
    peer: PeerRef;
    /** The message this one answers, when it is a reply. */
    inReplyTo: string | null;
}

/**
 * A message another agent sent into this thread.
 *
 * It arrives as a `data-signal` part, in one of two arrangements: folded into the
 * preceding assistant message when the thread loads as history, or alone in its
 * own message when it streams in live. Both are the same part, and a signal never
 * carries a text part, so neither arrangement leaves a stray bubble.
 */
function incomingPeerMessage(part: ChatMessagePart, at: string): PeerMessageDraft | null {
    if (part.type !== "data-signal") return null;
    const data = part.data as
        | {
              id?: unknown;
              contents?: unknown;
              tagName?: unknown;
              createdAt?: unknown;
              attributes?: {
                  messageId?: unknown;
                  replyToAgentName?: unknown;
                  inReplyTo?: unknown;
              };
              metadata?: { protocol?: unknown; replyToAgentId?: unknown };
          }
        | undefined;
    if (!data || data.tagName !== "agent-message") return null;
    if (data.metadata?.protocol !== AGENT_MESSAGE_PROTOCOL) return null;

    const name = data.attributes?.replyToAgentName;
    const text = data.contents;
    if (typeof name !== "string" || !name || typeof text !== "string" || !text.trim()) return null;

    const id = typeof data.attributes?.messageId === "string" ? data.attributes.messageId : null;
    return {
        id: id ?? (typeof data.id === "string" ? data.id : `${at}:in`),
        author: "peer",
        text: text.trim(),
        createdAt: typeof data.createdAt === "string" ? data.createdAt : at,
        inReplyTo: typeof data.attributes?.inReplyTo === "string" ? data.attributes.inReplyTo : null,
        // Only the sender knows its own id, and it rides on the signal's metadata
        // rather than its model-visible attributes.
        peer: {
            id: typeof data.metadata?.replyToAgentId === "string" ? data.metadata.replyToAgentId : null,
            name,
        },
    };
}

/**
 * A message this agent sent to another: a `sendAgentMessage` call that was
 * delivered.
 *
 * Undelivered calls are skipped on purpose — a refused target or a failed
 * validation is not part of a conversation, and counting them would make the row
 * claim more messages than were said.
 *
 * The result carries no agent id (the model addresses agents by name, never by
 * uuid), so an outgoing message identifies its peer by name alone.
 */
function outgoingPeerMessage(part: ChatMessagePart, at: string): PeerMessageDraft | null {
    if (part.type !== "tool-sendAgentMessage" || part.state !== "output-available") return null;

    const input = part.input as
        | { prompt?: unknown; targetAgentName?: unknown; inReplyTo?: unknown }
        | undefined;
    const output = part.output as
        | { delivered?: unknown; messageId?: unknown; targetAgentName?: unknown }
        | undefined;
    if (output?.delivered !== true) return null;

    const text = input?.prompt;
    // The server's name is authoritative; the model's is the fallback for a reply,
    // where it never named a target at all.
    const name = output.targetAgentName ?? input?.targetAgentName;
    if (typeof text !== "string" || !text.trim() || typeof name !== "string" || !name) return null;

    return {
        id: typeof output.messageId === "string" ? output.messageId : `${at}:out`,
        author: "agent",
        text: text.trim(),
        createdAt: at,
        inReplyTo: typeof input?.inReplyTo === "string" ? input.inReplyTo : null,
        peer: { id: null, name },
    };
}

/**
 * The message a chain starts from, following replies back.
 *
 * A reply names what it answers, so the first message with nothing above it
 * identifies the conversation. A reply whose parent is missing from this thread
 * still resolves to that parent's id, so siblings stay together, and a cycle
 * (which the protocol should never produce) stops rather than spins.
 */
function conversationRoot(messageId: string, parents: Map<string, string>): string {
    const seen = new Set<string>([messageId]);
    let current = messageId;
    for (;;) {
        const parent = parents.get(current);
        if (!parent || seen.has(parent)) return current;
        seen.add(parent);
        current = parent;
    }
}

/**
 * Where a peer message sat in the thread, before the rows are placed.
 *
 * Which conversation a message belongs to depends on messages that may come
 * later — a reply arriving further down is what makes an earlier message the
 * start of a chain — so each one leaves a marker and the rows are placed in a
 * second pass.
 */
interface PeerAnchor {
    kind: "anchor";
    peer: PeerRef;
    message: PeerMessageView;
    inReplyTo: string | null;
}

/**
 * Convert canonical AI SDK UI messages into what the thread shows. Tool state
 * remains in the canonical store; completed ask_user results are projected as
 * user bubbles so suspension answers survive a reload.
 *
 * Messages between agents never become bubbles. A message and its replies form
 * one conversation, shown as a single row where that conversation's latest message
 * landed — so the thread keeps reading as a conversation with the user, and two
 * messages nobody answered stay two separate rows rather than one invented
 * thread.
 */
export function projectChatMessages(messages: ChatMessageDto[]): ChatThreadItem[] {
    const optimisticToolAnswers = new Set(
        messages
            .filter((message) => message.role === "user")
            .map((message) => message.metadata?.pendingToolCallId)
            .filter((id): id is string => typeof id === "string"),
    );
    const questions = questionsByToolCallId(messages);
    const items: Array<ChatMessageView | PeerAnchor> = [];

    for (const message of messages) {
        const createdAt = messageCreatedAt(message);
        const pendingToolCallId = message.metadata?.pendingToolCallId;
        // A live answer quotes the question from the store; after a reload the
        // question comes from the persisted tool call itself.
        const answeredQuestion =
            (pendingToolCallId ? questions.get(pendingToolCallId) : undefined) ??
            message.metadata?.answeredQuestion;
        let textPartIndex = 0;

        for (const part of message.parts) {
            const peerMessage =
                incomingPeerMessage(part, createdAt) ?? outgoingPeerMessage(part, createdAt);
            if (peerMessage) {
                const { peer, inReplyTo, ...entry } = peerMessage;
                items.push({ kind: "anchor", peer, inReplyTo, message: entry });
                continue;
            }

            if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
                const isFirst = textPartIndex === 0;
                items.push({
                    kind: "message",
                    id: isFirst ? message.id : `${message.id}:text:${textPartIndex}`,
                    role: message.role,
                    text: part.text,
                    createdAt,
                    ...(message.role === "user" && isFirst && answeredQuestion
                        ? { replyTo: answeredQuestion }
                        : {}),
                    ...(message.role === "assistant" && message.metadata?.interrupted
                        ? { interrupted: true }
                        : {}),
                });
                textPartIndex += 1;
                continue;
            }

            const answer = askUserAnswer(part);
            if (!answer || (part.toolCallId && optimisticToolAnswers.has(part.toolCallId))) continue;
            const question = part.toolCallId ? questions.get(part.toolCallId) : undefined;
            items.push({
                kind: "message",
                id: `${message.id}:${part.toolCallId ?? "ask_user"}:answer`,
                role: "user",
                text: answer,
                createdAt,
                ...(question ? { replyTo: question } : {}),
            });
        }

        // A turn that ends thinking rather than speaking: the reasoning block is
        // the only copy of the answer, so show it instead of dropping the turn.
        // Reasoning that leads into more work is skipped — see the helper.
        if (message.role === "assistant") {
            const trailing = trailingReasoningText(message.parts);
            if (trailing) {
                items.push({
                    kind: "message",
                    id: `${message.id}:reasoning`,
                    role: "assistant",
                    text: trailing,
                    createdAt,
                });
            }
        }
    }

    return placeExchangeRows(items);
}

/**
 * Turn the per-message markers into one row per conversation.
 *
 * Two passes, because a chain is only known once every message has been seen: the
 * first resolves each message to the conversation it belongs to, the second drops
 * every marker but the last of each conversation and puts the row there.
 */
function placeExchangeRows(items: Array<ChatMessageView | PeerAnchor>): ChatThreadItem[] {
    const parents = new Map<string, string>();
    for (const item of items) {
        if (item.kind === "anchor" && item.inReplyTo) {
            parents.set(item.message.id, item.inReplyTo);
        }
    }

    const keyOf = new Map<PeerAnchor, string>();
    const exchanges = new Map<string, PeerExchangeView>();
    const lastAnchorIndex = new Map<string, number>();

    items.forEach((item, index) => {
        if (item.kind !== "anchor") return;
        const key = conversationRoot(item.message.id, parents);
        keyOf.set(item, key);
        lastAnchorIndex.set(key, index);

        const existing = exchanges.get(key);
        if (!existing) {
            exchanges.set(key, {
                kind: "exchange",
                id: `exchange:${key}`,
                peer: item.peer,
                messages: [item.message],
                createdAt: item.message.createdAt,
                updatedAt: item.message.createdAt,
            });
            return;
        }
        // An id learned from an incoming message sticks: outgoing calls carry only
        // a name, so this is the one chance to know which agent the row is about.
        if (!existing.peer.id && item.peer.id) {
            existing.peer = { ...existing.peer, id: item.peer.id };
        }
        existing.messages.push(item.message);
        existing.updatedAt = item.message.createdAt;
    });

    const placed: ChatThreadItem[] = [];
    items.forEach((item, index) => {
        if (item.kind !== "anchor") {
            placed.push(item);
            return;
        }
        // Only the conversation's latest marker becomes the row; the earlier ones
        // were only positions.
        const key = keyOf.get(item);
        if (!key || lastAnchorIndex.get(key) !== index) return;
        const exchange = exchanges.get(key);
        if (exchange) placed.push(exchange);
    });
    return placed;
}
