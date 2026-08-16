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
});
