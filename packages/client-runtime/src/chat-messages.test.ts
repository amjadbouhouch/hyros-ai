import { describe, expect, test } from "bun:test";

import type { ChatMessageDto, ChatMessagePart } from "@hyros-ai/domain";
import {
    projectChatMessages,
    type ChatMessageView,
    type ChatThreadItem,
    type PeerExchangeView,
} from "./chat-messages.js";

const bubbles = (items: ChatThreadItem[]): ChatMessageView[] =>
    items.filter((item): item is ChatMessageView => item.kind === "message");

const exchanges = (items: ChatThreadItem[]): PeerExchangeView[] =>
    items.filter((item): item is PeerExchangeView => item.kind === "exchange");

function assistant(id: string, at: string, parts: ChatMessagePart[]): ChatMessageDto {
    return { id, role: "assistant", metadata: { createdAt: at }, parts };
}

function user(id: string, at: string, text: string): ChatMessageDto {
    return { id, role: "user", metadata: { createdAt: at }, parts: [{ type: "text", text }] };
}

const toolAnswer: ChatMessageDto = assistant("assistant-1", "2026-08-16T00:00:00.000Z", [
    {
        type: "tool-ask_user",
        toolCallId: "tool-1",
        state: "output-available",
        input: { question: "Choose a tone" },
        output: { content: "User answered: Formal", isError: false },
    },
]);

describe("projectChatMessages", () => {
    test("renders a persisted ask_user tool result as the user's answer", () => {
        expect(projectChatMessages([toolAnswer])).toEqual([
            {
                kind: "message",
                id: "assistant-1:tool-1:answer",
                role: "user",
                text: "Formal",
                createdAt: "2026-08-16T00:00:00.000Z",
                replyTo: "Choose a tone",
            },
        ]);
    });

    test("quotes the question on a live answer, before the tool result lands", () => {
        const suspended = assistant("assistant-1", "2026-08-16T00:00:00.000Z", [
            {
                type: "tool-ask_user",
                toolCallId: "tool-1",
                state: "input-available",
                input: { question: "Choose a tone" },
            },
        ]);
        const optimistic: ChatMessageDto = {
            id: "user-1",
            role: "user",
            metadata: {
                createdAt: "2026-08-16T00:00:01.000Z",
                pendingToolCallId: "tool-1",
                optimistic: true,
            },
            parts: [{ type: "text", text: "Formal" }],
        };

        expect(projectChatMessages([suspended, optimistic])).toEqual([
            {
                kind: "message",
                id: "user-1",
                role: "user",
                text: "Formal",
                createdAt: "2026-08-16T00:00:01.000Z",
                replyTo: "Choose a tone",
            },
        ]);
    });

    test("falls back to the question captured in message metadata", () => {
        const optimistic: ChatMessageDto = {
            id: "user-1",
            role: "user",
            metadata: {
                createdAt: "2026-08-16T00:00:01.000Z",
                pendingToolCallId: "tool-1",
                answeredQuestion: "Choose a tone",
                optimistic: true,
            },
            parts: [{ type: "text", text: "Formal" }],
        };

        expect(bubbles(projectChatMessages([optimistic]))[0]?.replyTo).toBe("Choose a tone");
    });

    test("does not duplicate a live optimistic answer", () => {
        const optimistic: ChatMessageDto = {
            id: "user-1",
            role: "user",
            metadata: {
                createdAt: "2026-08-16T00:00:01.000Z",
                pendingToolCallId: "tool-1",
                optimistic: true,
            },
            parts: [{ type: "text", text: "Formal" }],
        };

        expect(bubbles(projectChatMessages([toolAnswer, optimistic])).map((b) => b.text)).toEqual([
            "Formal",
        ]);
    });

    test("shows an answer the model left in its reasoning channel", () => {
        // A real glm-4.7 turn (thread 5682b1c2, 2026-08-17): it spoke once, ran
        // commands, then put the whole report in reasoning and emitted no closing
        // text. Before this, the turn rendered as nothing.
        const turn = assistant("assistant-1", "2026-08-17T14:30:12.000Z", [
            { type: "reasoning", reasoning: "The user wants me to test the sandbox." },
            { type: "text", text: "Testing the sandbox!" },
            { type: "tool-invocation", toolCallId: "t1" },
            { type: "step-start" },
            { type: "reasoning", reasoning: "🧪 Sandbox Test Results\n\n✅ operational" },
        ]);

        expect(bubbles(projectChatMessages([turn])).map((b) => b.text)).toEqual([
            "Testing the sandbox!",
            "🧪 Sandbox Test Results\n\n✅ operational",
        ]);
    });

    test("keeps mid-run deliberation hidden", () => {
        const turn = assistant("assistant-2", "2026-08-17T14:30:12.000Z", [
            { type: "reasoning", reasoning: "internal chatter nobody should see" },
            { type: "tool-invocation", toolCallId: "t1" },
            { type: "text", text: "Here is the result." },
        ]);

        expect(bubbles(projectChatMessages([turn])).map((b) => b.text)).toEqual([
            "Here is the result.",
        ]);
    });

    // ── Agent-to-agent exchanges ─────────────────────────────────────────────
    //
    // Both fixtures are the shapes the gateway really produced for Orbit and
    // Scout (threads cbb7678b / 509a114c, 2026-08-17): a `data-signal` part for
    // what an agent received, a `tool-sendAgentMessage` call for what it sent.

    function wroteIn(text: string, id = "in-1", at = "2026-08-17T16:43:15.000Z"): ChatMessagePart {
        return {
            type: "data-signal",
            data: {
                id,
                type: "notification",
                tagName: "agent-message",
                contents: text,
                // A signal carries its own send time, which is the truth for when
                // the peer wrote — not when the message it rode in on was saved.
                createdAt: at,
                attributes: { messageId: id, replyToAgentName: "Orbit", expectsReply: false },
                metadata: {
                    protocol: "hyros-agent-message-v1",
                    messageId: id,
                    replyToAgentId: "orbit-id",
                    targetAgentId: "scout-id",
                },
            },
        };
    }

    /** An incoming message that answers one of ours. */
    function replyIn(text: string, id: string, inReplyTo: string, at: string): ChatMessagePart {
        const part = wroteIn(text, id, at) as ChatMessagePart & {
            data: { attributes: Record<string, unknown>; metadata: Record<string, unknown> };
        };
        part.data.attributes.inReplyTo = inReplyTo;
        part.data.metadata.inReplyTo = inReplyTo;
        return part;
    }

    function sentOut(
        text: string,
        options: { to?: string; id?: string; delivered?: boolean; inReplyTo?: string } = {},
    ): ChatMessagePart {
        const { to = "Orbit", id = "out-1", delivered = true, inReplyTo } = options;
        return {
            type: "tool-sendAgentMessage",
            toolCallId: `tool-${id}`,
            state: "output-available",
            input: inReplyTo
                ? { kind: "reply", prompt: text, inReplyTo }
                : { kind: "message", prompt: text, replyMode: "none", targetAgentName: to },
            output: delivered
                ? { delivered: true, code: "DELIVERED", messageId: id, targetAgentName: to }
                : { delivered: false, code: "TARGET_NOT_FOUND", message: "no such agent" },
        };
    }

    test("collapses an incoming message into a row, in place, and never a bubble", () => {
        // History folds the signal onto the end of the preceding assistant
        // message, so the row has to land between that one and the next.
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:40:00.000Z", [
                { type: "text", text: "Talk soon!" },
                wroteIn("Hi Scout! I'm Orbit, your new teammate."),
            ]),
            assistant("a-2", "2026-08-17T16:43:20.000Z", [
                { type: "text", text: "Orbit introduced themselves — project coordination." },
            ]),
        ]);

        expect(items.map((item) => item.kind)).toEqual(["message", "exchange", "message"]);
        expect(items[1]).toEqual({
            kind: "exchange",
            id: "exchange:in-1",
            peer: { id: "orbit-id", name: "Orbit" },
            createdAt: "2026-08-17T16:43:15.000Z",
            updatedAt: "2026-08-17T16:43:15.000Z",
            messages: [
                {
                    id: "in-1",
                    author: "peer",
                    text: "Hi Scout! I'm Orbit, your new teammate.",
                    createdAt: "2026-08-17T16:43:15.000Z",
                },
            ],
        });
        // The agent's own words still reach the user.
        expect(bubbles(items).map((b) => b.text)).toEqual([
            "Talk soon!",
            "Orbit introduced themselves — project coordination.",
        ]);
    });

    test("handles the live arrangement, where the signal arrives alone", () => {
        const items = projectChatMessages([
            assistant("in-msg", "2026-08-17T16:43:15.000Z", [wroteIn("Anything to report?")]),
            assistant("a-2", "2026-08-17T16:43:20.000Z", [{ type: "text", text: "On it." }]),
        ]);

        expect(items.map((item) => item.kind)).toEqual(["exchange", "message"]);
        expect(exchanges(items)[0]?.messages).toHaveLength(1);
    });

    test("collects what the agent sent as well as what it received", () => {
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:15.000Z", [wroteIn("Are you free?")]),
            assistant("a-2", "2026-08-17T16:43:30.000Z", [
                { type: "reasoning", reasoning: "reply to Orbit" },
                sentOut("Yes — sending the plan now.", { id: "out-1", inReplyTo: "in-1" }),
                { type: "text", text: "Told Orbit I'd send the plan." },
            ]),
        ]);

        const [exchange] = exchanges(items);
        expect(exchange?.messages).toEqual([
            {
                id: "in-1",
                author: "peer",
                text: "Are you free?",
                createdAt: "2026-08-17T16:43:15.000Z",
            },
            {
                id: "out-1",
                author: "agent",
                text: "Yes — sending the plan now.",
                createdAt: "2026-08-17T16:43:30.000Z",
            },
        ]);
        // One row for the pair, then the agent's report to the user.
        expect(items.map((item) => item.kind)).toEqual(["exchange", "message"]);
        expect(bubbles(items).map((b) => b.text)).toEqual(["Told Orbit I'd send the plan."]);
    });

    test("skips a send that was never delivered", () => {
        // A refused target or a failed validation is not part of a conversation,
        // and counting it would make the row claim more than was said.
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:30.000Z", [
                sentOut("hello?", { delivered: false }),
                sentOut("hello again", { id: "out-2" }),
            ]),
        ]);

        expect(exchanges(items)[0]?.messages.map((m) => m.text)).toEqual(["hello again"]);
    });

    test("starts a new row when the peer changes", () => {
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:30.000Z", [
                sentOut("hi Orbit", { to: "Orbit", id: "out-1" }),
                sentOut("hi Atlas", { to: "Atlas", id: "out-2" }),
            ]),
        ]);

        expect(exchanges(items).map((e) => e.peer.name)).toEqual(["Orbit", "Atlas"]);
    });

    test("keeps two unanswered messages as two rows", () => {
        // The case that broke the earlier attempts. Orbit sent Scout two
        // notifications and Scout answered its own user both times, never Orbit.
        // Those are two things said, not one conversation, and calling them one
        // invented a thread that never existed.
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:15.000Z", [wroteIn("first", "in-1")]),
            assistant("a-2", "2026-08-17T16:43:20.000Z", [{ type: "text", text: "Noted." }]),
            assistant("a-3", "2026-08-17T16:43:25.000Z", [
                wroteIn("second", "in-2", "2026-08-17T16:43:25.000Z"),
            ]),
            assistant("a-4", "2026-08-17T16:43:30.000Z", [{ type: "text", text: "Noted again." }]),
        ]);

        expect(items.map((item) => item.kind)).toEqual([
            "exchange",
            "message",
            "exchange",
            "message",
        ]);
        expect(exchanges(items).map((e) => e.messages.map((m) => m.text))).toEqual([
            ["first"],
            ["second"],
        ]);
    });

    test("joins a reply to the message it answers, however deep", () => {
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:15.000Z", [wroteIn("are you free?", "in-1")]),
            assistant("a-2", "2026-08-17T16:43:20.000Z", [
                sentOut("yes — sending it", { id: "out-1", inReplyTo: "in-1" }),
                { type: "text", text: "Told Orbit I'd send it." },
            ]),
            assistant("a-3", "2026-08-17T16:43:25.000Z", [
                replyIn("got it, thanks", "in-2", "out-1", "2026-08-17T16:43:25.000Z"),
            ]),
        ]);

        // One conversation, three messages, sitting where the latest one landed.
        const [exchange, ...rest] = exchanges(items);
        expect(rest).toEqual([]);
        expect(exchange?.messages.map((m) => [m.author, m.text])).toEqual([
            ["peer", "are you free?"],
            ["agent", "yes — sending it"],
            ["peer", "got it, thanks"],
        ]);
        expect(items.map((item) => item.kind)).toEqual(["message", "exchange"]);
        expect(exchange?.createdAt).toBe("2026-08-17T16:43:15.000Z");
        expect(exchange?.updatedAt).toBe("2026-08-17T16:43:25.000Z");
    });

    test("keeps separate conversations separate, whoever they are with", () => {
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:15.000Z", [
                sentOut("hi Orbit", { to: "Orbit", id: "out-1" }),
                sentOut("hi Atlas", { to: "Atlas", id: "out-2" }),
            ]),
            assistant("a-2", "2026-08-17T16:43:20.000Z", [{ type: "text", text: "Both told." }]),
            assistant("a-3", "2026-08-17T16:43:25.000Z", [
                sentOut("Orbit, one more thing", { to: "Orbit", id: "out-3" }),
            ]),
        ]);

        expect(exchanges(items).map((e) => [e.peer.name, e.messages.length])).toEqual([
            ["Orbit", 1],
            ["Atlas", 1],
            ["Orbit", 1],
        ]);
    });

    test("learns the peer's id from the reply that arrives", () => {
        // Outgoing calls know a name but no id, because the model never sees a
        // uuid. A reply carries one, and the row needs it to find an avatar.
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:15.000Z", [sentOut("morning", { id: "out-1" })]),
            assistant("a-2", "2026-08-17T16:43:20.000Z", [
                wroteIn("morning back", "in-1", "2026-08-17T16:43:20.000Z"),
            ]),
        ]);

        // Not a chain: nothing correlates them, so they stay apart...
        expect(exchanges(items)).toHaveLength(2);
        expect(exchanges(items)[0]?.peer).toEqual({ id: null, name: "Orbit" });
        expect(exchanges(items)[1]?.peer).toEqual({ id: "orbit-id", name: "Orbit" });
    });

    test("carries the peer id across a correlated chain", () => {
        // A reply to our own message: one row, and the id comes off the reply.
        const chained = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:15.000Z", [sentOut("morning", { id: "out-1" })]),
            assistant("a-2", "2026-08-17T16:43:20.000Z", [
                replyIn("morning back", "in-1", "out-1", "2026-08-17T16:43:20.000Z"),
            ]),
        ]);
        expect(exchanges(chained)).toHaveLength(1);
        expect(exchanges(chained)[0]?.peer).toEqual({ id: "orbit-id", name: "Orbit" });
        expect(exchanges(chained)[0]?.messages.map((m) => m.author)).toEqual(["agent", "peer"]);
    });

    test("ignores signals that are not agent messages", () => {
        const items = projectChatMessages([
            assistant("a-1", "2026-08-17T16:43:15.000Z", [
                {
                    type: "data-signal",
                    data: { tagName: "system-reminder", contents: "internal", metadata: {} },
                },
                { type: "text", text: "Sure." },
            ]),
        ]);

        expect(items.map((item) => item.kind)).toEqual(["message"]);
    });

    test("keeps a failure note as its own voice, not the agent's", () => {
        // A run that died is not the agent talking. Projecting it as `assistant`
        // dressed a crash up as a reply.
        expect(
            projectChatMessages([
                {
                    id: "error:1",
                    role: "system",
                    metadata: { createdAt: "2026-08-16T00:00:05.000Z" },
                    parts: [{ type: "text", text: "agent run failed" }],
                },
            ]),
        ).toEqual([
            {
                kind: "message",
                id: "error:1",
                role: "system",
                text: "agent run failed",
                createdAt: "2026-08-16T00:00:05.000Z",
            },
        ]);
    });

    test("keeps a user message plain", () => {
        expect(projectChatMessages([user("user-2", "2026-08-16T00:00:02.000Z", "Hello")])).toEqual([
            {
                kind: "message",
                id: "user-2",
                role: "user",
                text: "Hello",
                createdAt: "2026-08-16T00:00:02.000Z",
            },
        ]);
    });
});
