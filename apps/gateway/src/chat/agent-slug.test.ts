import { describe, expect, test } from "bun:test";

import { slugifyAgentName } from "./agent-slug.js";

describe("slugifyAgentName", () => {
    test("creates the canonical address used for routing", () => {
        expect(slugifyAgentName("  Project Manager  ")).toBe("project-manager");
        expect(slugifyAgentName("Picka's Content Helper")).toBe(
            "picka-s-content-helper",
        );
    });

    test("normalizes accents, punctuation, and repeated separators", () => {
        expect(slugifyAgentName("Résumé & Déploiement!!!")).toBe(
            "resume-deploiement",
        );
    });

    test("returns an empty address when a name has no ASCII letters or digits", () => {
        expect(slugifyAgentName("🤖✨")).toBe("");
    });
});
