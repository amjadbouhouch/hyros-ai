import { describe, expect, test } from "bun:test";

import type { ChatMessageDto } from "@hyros-ai/domain";

import { projectChats } from "./chat.js";
import type { AgentSummary } from "./transport.js";

const agent = (overrides: Partial<AgentSummary> = {}): AgentSummary => ({
    id: "agent-1",
    name: "Nova",
    description: null,
    avatarUrl: null,
    lastMessage: null,
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
});

const textMessage = (
    id: string,
    role: ChatMessageDto["role"],
    text: string,
    createdAt: string,
): ChatMessageDto => ({
    id,
    role,
    metadata: { createdAt },
    parts: [{ type: "text", text }],
});

describe("projectChats", () => {
    test("agents with no live state fall back to the persisted preview", () => {
        const chats = projectChats(
            [
                agent({
                    lastMessage: {
                        text: "Persisted last message",
                        role: "agent",
                        createdAt: "2026-08-26T01:00:00.000Z",
                    },
                }),
            ],
            { agents: {} },
        );
        expect(chats).toHaveLength(1);
        expect(chats[0]!.running).toBe(false);
        expect(chats[0]!.pendingQuestion).toBeNull();
        expect(chats[0]!.lastMessage?.text).toBe("Persisted last message");
        expect(chats[0]!.messages).toHaveLength(0);
    });

    test("live state wins over the persisted preview", () => {
        const chats = projectChats(
            [
                agent({
                    lastMessage: {
                        text: "Stale persisted preview",
                        role: "agent",
                        createdAt: "2026-08-26T01:00:00.000Z",
                    },
                }),
            ],
            {
                agents: {
                    "agent-1": {
                        threadId: "thread-1",
                        running: true,
                        answering: null,
                        attached: true,
                        pendingQuestion: null,
                        messages: [
                            textMessage(
                                "m1",
                                "user",
                                "Hello Nova",
                                "2026-08-26T02:00:00.000Z",
                            ),
                            textMessage(
                                "m2",
                                "assistant",
                                "Live reply",
                                "2026-08-26T02:01:00.000Z",
                            ),
                        ],
                    },
                },
            },
        );
        expect(chats[0]!.running).toBe(true);
        expect(chats[0]!.lastMessage?.text).toBe("Live reply");
        expect(chats[0]!.lastMessage?.role).toBe("agent");
        expect(chats[0]!.messages).toHaveLength(2);
    });

    test("a pending question surfaces on the live chat", () => {
        const chats = projectChats([agent()], {
            agents: {
                "agent-1": {
                    threadId: "thread-1",
                    running: true,
                    answering: null,
                    attached: true,
                    pendingQuestion: {
                        toolCallId: "call-1",
                        question: "What would you like to call me?",
                        options: [{ label: "Nova" }],
                    },
                    messages: [],
                },
            },
        });
        expect(chats[0]!.pendingQuestion?.question).toBe(
            "What would you like to call me?",
        );
    });
});
