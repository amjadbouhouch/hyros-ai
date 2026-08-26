import { describe, expect, test } from "bun:test";

import { messageText } from "./message-text.js";

describe("messageText", () => {
    test("extracts visible text from a format-v2 envelope", () => {
        expect(
            messageText({
                format: 2,
                parts: [
                    { type: "reasoning", text: "private chain of thought" },
                    { type: "text", text: "Hello" },
                    { type: "text", text: " there" },
                ],
            }),
        ).toBe("Hello there");
    });

    test("ignores a trailing reasoning block — thinking never previews", () => {
        expect(
            messageText({
                format: 2,
                parts: [
                    { type: "text", text: "Testing the sandbox!" },
                    { type: "tool-invocation" },
                    { type: "step-start" },
                    { type: "reasoning", reasoning: "🧪 Sandbox Test Results" },
                ],
            }),
        ).toBe("Testing the sandbox!");
    });

    test("returns empty for a reasoning-only turn — thinking stays internal", () => {
        expect(
            messageText({
                format: 2,
                parts: [
                    { type: "step-start" },
                    { type: "reasoning", reasoning: "private chain of thought" },
                ],
            }),
        ).toBe("");
    });
});
