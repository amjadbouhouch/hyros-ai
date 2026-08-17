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
                answeredQuestion: "Choose a tone",
            },
        ]);
    });

    test("quotes the question on a live answer, before the tool result lands", () => {
        const suspended: ChatMessageDto = {
            id: "assistant-1",
            role: "assistant",
            metadata: { createdAt: "2026-08-16T00:00:00.000Z" },
            parts: [
                {
                    type: "tool-ask_user",
                    toolCallId: "tool-1",
                    state: "input-available",
                    input: { question: "Choose a tone" },
                },
            ],
        };
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
                id: "user-1",
                role: "user",
                text: "Formal",
                createdAt: "2026-08-16T00:00:01.000Z",
                answeredQuestion: "Choose a tone",
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

        expect(projectChatMessages([optimistic])[0]?.answeredQuestion).toBe(
            "Choose a tone",
        );
    });

    test("shows an answer the model left in its reasoning channel", () => {
        // The shape of a real glm-4.7 turn (thread 5682b1c2, 2026-08-17): it
        // spoke once, ran seven commands, then put the whole report in reasoning
        // and emitted no closing text. Before this, the turn rendered as nothing.
        const turn: ChatMessageDto = {
            id: "assistant-1",
            role: "assistant",
            metadata: { createdAt: "2026-08-17T14:30:12.000Z" },
            parts: [
                { type: "reasoning", reasoning: "The user wants me to test the sandbox." },
                { type: "text", text: "Testing the sandbox! Let me run a quick diagnostic!" },
                { type: "tool-invocation", toolCallId: "t1" },
                { type: "data-workspace-metadata" },
                { type: "data-sandbox-exit" },
                { type: "step-start" },
                { type: "reasoning", reasoning: "🧪 Sandbox Test Results\n\n✅ operational" },
            ],
        };

        expect(projectChatMessages([turn])).toEqual([
            {
                id: "assistant-1",
                role: "assistant",
                text: "Testing the sandbox! Let me run a quick diagnostic!",
                createdAt: "2026-08-17T14:30:12.000Z",
            },
            {
                id: "assistant-1:reasoning",
                role: "assistant",
                text: "🧪 Sandbox Test Results\n\n✅ operational",
                createdAt: "2026-08-17T14:30:12.000Z",
            },
        ]);
    });

    test("keeps mid-run deliberation hidden", () => {
        const turn: ChatMessageDto = {
            id: "assistant-2",
            role: "assistant",
            metadata: { createdAt: "2026-08-17T14:30:12.000Z" },
            parts: [
                { type: "reasoning", reasoning: "internal chatter nobody should see" },
                { type: "tool-invocation", toolCallId: "t1" },
                { type: "text", text: "Here is the result." },
            ],
        };

        expect(projectChatMessages([turn]).map((view) => view.text)).toEqual([
            "Here is the result.",
        ]);
    });

    test("leaves an ordinary user message unquoted", () => {
        const plain: ChatMessageDto = {
            id: "user-2",
            role: "user",
            metadata: { createdAt: "2026-08-16T00:00:02.000Z" },
            parts: [{ type: "text", text: "Hello" }],
        };

        expect(projectChatMessages([plain])[0]).not.toHaveProperty(
            "answeredQuestion",
        );
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
