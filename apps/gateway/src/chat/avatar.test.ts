import { describe, expect, test } from "bun:test";

import { renderAvatarDataUri } from "./avatar.js";

describe("renderAvatarDataUri", () => {
    test("renders the selected style and config into a local SVG data URI", () => {
        const avatar = renderAvatarDataUri({
            style: "identicon",
            config: {
                seed: "cosmic-fox",
                backgroundColor: "ffcc88",
                borderRadius: 16,
            },
        });

        expect(avatar).toStartWith("data:image/svg+xml;charset=utf-8,");
        expect(decodeURIComponent(avatar.split(",", 2)[1] ?? "")).toContain("<svg");
    });

    test("is deterministic and does not collapse different styles", () => {
        const config = { seed: "same-agent" };

        const first = renderAvatarDataUri({ style: "identicon", config });
        const second = renderAvatarDataUri({ style: "identicon", config });
        const clay = renderAvatarDataUri({ style: "clay", config });

        expect(second).toBe(first);
        expect(clay).not.toBe(first);
    });

    test("rejects config keys unsupported by the selected style", () => {
        expect(() =>
            renderAvatarDataUri({
                style: "identicon",
                config: { seed: "agent", madeUpOption: "wrong" },
            }),
        ).toThrow("Invalid DiceBear config for identicon");
    });
});
