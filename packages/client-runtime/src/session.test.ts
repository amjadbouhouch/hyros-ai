import { describe, expect, test } from "bun:test";

import type { UserProfile } from "@hyros-ai/domain";

import {
    createSessionManager,
    type SessionStore,
    type StoredSession,
} from "./session.js";

/** In-memory SessionStore for tests (mirrors what TASK-015 provides per platform). */
function memoryStore(
    initial: StoredSession | null = null,
): SessionStore & { current: StoredSession | null } {
    const state = { current: initial };
    return {
        get current() {
            return state.current;
        },
        async load() {
            return state.current;
        },
        async save(session) {
            state.current = session;
        },
        async clear() {
            state.current = null;
        },
    };
}

const profile: UserProfile = {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    avatarUrl: null,
};

describe("createSessionManager", () => {
    test("restore returns signed-out when nothing is stored", async () => {
        const manager = createSessionManager({
            store: memoryStore(),
            fetchProfile: async () => profile,
        });
        expect(await manager.restore()).toEqual({ status: "signed-out" });
    });

    test("restore verifies the stored token and returns the profile", async () => {
        const seenTokens: string[] = [];
        const manager = createSessionManager({
            store: memoryStore({ accessToken: "tok", refreshToken: "ref" }),
            fetchProfile: async (token) => {
                seenTokens.push(token);
                return profile;
            },
        });
        expect(await manager.restore()).toEqual({
            status: "signed-in",
            profile,
        });
        expect(seenTokens).toEqual(["tok"]);
    });

    test("restore returns error but keeps the store when verification fails", async () => {
        const store = memoryStore({ accessToken: "tok", refreshToken: "ref" });
        const manager = createSessionManager({
            store,
            fetchProfile: async () => {
                throw new Error("gateway down");
            },
        });
        const result = await manager.restore();
        expect(result.status).toBe("error");
        // A network failure must not wipe a potentially valid session.
        expect(await store.load()).not.toBeNull();
    });

    test("signOut clears the store", async () => {
        const store = memoryStore({ accessToken: "tok", refreshToken: "ref" });
        const manager = createSessionManager({
            store,
            fetchProfile: async () => profile,
        });
        await manager.signOut();
        expect(await store.load()).toBeNull();
    });
});