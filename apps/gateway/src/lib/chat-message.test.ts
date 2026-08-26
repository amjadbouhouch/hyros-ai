import { describe, expect, test } from "bun:test";
import type { MastraDBMessage } from "@mastra/core/agent";

import { isWireWorthy, toChatMessage, toChatMessages } from "./chat-message.js";

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

    test("strips reasoning parts in both wire shapes — thinking never leaves the gateway", () => {
        // AIV5.UI conversion emits reasoning as { type: "reasoning", text } —
        // the shape clients would render live.
        const aiv5 = {
            id: "message-1",
            role: "assistant",
            createdAt: new Date("2026-08-26T00:00:00.000Z"),
            content: [
                { type: "reasoning", text: "private chain of thought" },
                { type: "text", text: "Visible answer" },
            ],
        } as unknown as MastraDBMessage;
        expect(toChatMessage(aiv5).parts).toEqual([{ type: "text", text: "Visible answer" }]);

        // format-v2 envelopes persist reasoning as a `reasoning` string — the
        // shape seen in mastra_messages rows.
        const formatV2 = {
            id: "message-2",
            role: "assistant",
            createdAt: new Date("2026-08-26T00:01:00.000Z"),
            content: {
                format: 2,
                parts: [
                    { type: "reasoning", reasoning: "internal monologue" },
                    { type: "text", text: "Public reply" },
                ],
            },
        } as MastraDBMessage;
        expect(toChatMessages([formatV2])[0]!.parts).toEqual([
            { type: "text", text: "Public reply" },
        ]);
    });

    test("a reasoning-only turn strips to no parts and is not wire-worthy", () => {
        const message = {
            id: "message-3",
            role: "assistant",
            createdAt: new Date("2026-08-26T00:02:00.000Z"),
            content: {
                format: 2,
                parts: [{ type: "reasoning", reasoning: "only thinking here" }],
            },
        } as MastraDBMessage;
        const dto = toChatMessage(message);
        expect(dto.parts).toHaveLength(0);
        expect(isWireWorthy(dto)).toBe(false);
    });

    test("tool parts survive the strip — ask_user quoting keeps working", () => {
        const message = {
            id: "message-4",
            role: "assistant",
            createdAt: new Date("2026-08-26T00:03:00.000Z"),
            content: {
                format: 2,
                parts: [
                    { type: "reasoning", reasoning: "deciding what to ask" },
                    {
                        type: "tool-invocation",
                        toolInvocation: {
                            state: "result",
                            toolCallId: "tool-1",
                            toolName: "ask_user",
                            args: { question: "Pick one" },
                            result: { content: "User answered: A", isError: false },
                        },
                    },
                ],
            },
        } as MastraDBMessage;
        const dto = toChatMessage(message);
        expect(dto.parts).toHaveLength(1);
        expect(isWireWorthy(dto)).toBe(true);
    });
});
