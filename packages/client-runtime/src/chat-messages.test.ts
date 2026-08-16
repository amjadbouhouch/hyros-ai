import { describe, expect, test } from "bun:test";

import type { ChatMessageDto } from "@hyros-ai/domain";
import { projectChatMessages } from "./chat-messages.js";

const toolAnswer: ChatMessageDto = {
    id: "assistant-1",
    role: "assistant",
    metadata: { createdAt: "2026-08-16T00:00:00.000Z" },
    parts: [
        {
            type: "tool-ask_user",
            toolCallId: "tool-1",
            state: "output-available",
            input: { question: "Choose a tone" },
            output: { content: "User answered: Formal", isError: false },
        },
    ],
};

describe("projectChatMessages", () => {
    test("renders a persisted ask_user tool result as the user's answer", () => {
        expect(projectChatMessages([toolAnswer])).toEqual([
            {
                id: "assistant-1:tool-1:answer",
                role: "user",
                text: "Formal",
                createdAt: "2026-08-16T00:00:00.000Z",
            },
        ]);
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

        expect(projectChatMessages([toolAnswer, optimistic]).map((message) => message.text)).toEqual([
            "Formal",
        ]);
    });
});
