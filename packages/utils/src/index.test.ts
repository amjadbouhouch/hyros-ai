import { describe, expect, test } from "bun:test";

import { trailingReasoningText } from "./index.js";

describe("trailingReasoningText", () => {
    test("returns a trailing reasoning block — the model's answer", () => {
        // The real shape from a glm-4.7 turn: it spoke once, ran tools, then put
        // the whole report in its reasoning channel and emitted no more text.
        expect(
            trailingReasoningText([
                { type: "reasoning", reasoning: "planning the diagnostic" },
                { type: "text", text: "Testing the sandbox!" },
                { type: "tool-invocation" },
                { type: "data-workspace-metadata" },
                { type: "data-sandbox-exit" },
                { type: "step-start" },
                { type: "reasoning", reasoning: "🧪 Sandbox Test Results\n\n✅ all good" },
            ]),
        ).toBe("🧪 Sandbox Test Results\n\n✅ all good");
    });

    test("ignores reasoning that precedes more work", () => {
        // Deliberation before a tool call, or before the model speaks, is not an
        // answer and must stay hidden.
        expect(
            trailingReasoningText([
                { type: "reasoning", reasoning: "the user is asking about X" },
                { type: "tool-invocation" },
            ]),
        ).toBeNull();
        expect(
            trailingReasoningText([
                { type: "reasoning", reasoning: "thinking" },
                { type: "text", text: "Here you go." },
            ]),
        ).toBeNull();
    });

    test("looks past an empty text part, which is what a reasoning-only turn leaves", () => {
        expect(
            trailingReasoningText([
                { type: "reasoning", reasoning: "the answer" },
                { type: "text", text: "   " },
            ]),
        ).toBe("the answer");
    });

    test("reads AI SDK reasoning parts, which carry their content in `text`", () => {
        expect(trailingReasoningText([{ type: "reasoning", text: "the answer" }])).toBe(
            "the answer",
        );
    });

    test("returns null for messages with no reasoning at the end", () => {
        expect(trailingReasoningText([])).toBeNull();
        expect(trailingReasoningText([{ type: "text", text: "hello" }])).toBeNull();
        expect(trailingReasoningText([{ type: "reasoning", reasoning: "  " }])).toBeNull();
        expect(trailingReasoningText([{ type: "tool-invocation" }])).toBeNull();
    });
});
