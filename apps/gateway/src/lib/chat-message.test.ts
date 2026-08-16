import { describe, expect, test } from "bun:test";
import type { MastraDBMessage } from "@mastra/core/agent";

import { toChatMessage } from "./chat-message.js";

describe("toChatMessage", () => {
    test("preserves a completed ask_user invocation in AI SDK UIMessage format", () => {
        const message = {
            id: "message-1",
            role: "assistant",
            createdAt: new Date("2026-08-16T00:00:00.000Z"),
            content: {
                format: 2,
                parts: [
                    {
                        type: "tool-invocation",
                        toolInvocation: {
                            state: "result",
                            toolCallId: "tool-1",
                            toolName: "ask_user",
                            args: {
                                question: "Choose a tone",
                                options: [{ label: "Formal" }, { label: "Friendly" }],
                            },
                            result: { content: "User answered: Formal", isError: false },
                        },
                    },
                ],
            },
        } as MastraDBMessage;

        expect(toChatMessage(message)).toEqual({
            id: "message-1",
            role: "assistant",
            metadata: { createdAt: "2026-08-16T00:00:00.000Z" },
            parts: [
                {
                    type: "tool-ask_user",
                    toolCallId: "tool-1",
                    state: "output-available",
                    input: {
                        question: "Choose a tone",
                        options: [{ label: "Formal" }, { label: "Friendly" }],
                    },
                    output: { content: "User answered: Formal", isError: false },
                },
            ],
        });
    });
});
