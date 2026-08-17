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

    test("prefers a trailing reasoning block — the newest thing the agent said", () => {
        // A reasoning model that ends its turn thinking leaves the answer there
        // and nowhere else, so the chat list has to show it.
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
        ).toBe("🧪 Sandbox Test Results");
    });

    test("still hides reasoning that leads into more work", () => {
        expect(
            messageText({
                format: 2,
                parts: [
                    { type: "reasoning", reasoning: "private chain of thought" },
                    { type: "tool-invocation" },
                    { type: "text", text: "Done." },
                ],
            }),
        ).toBe("Done.");
    });
});
