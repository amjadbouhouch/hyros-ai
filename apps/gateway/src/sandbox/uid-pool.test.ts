import { describe, expect, test } from "bun:test";

import {
    allocateSandboxUid,
    isUidInPool,
    SandboxUidPoolExhaustedError,
    UID_BASE,
    UID_POOL_SIZE,
} from "./uid-pool.js";

describe("allocateSandboxUid", () => {
    test("starts at the base of the pool", () => {
        expect(allocateSandboxUid("org-1", [])).toBe(UID_BASE);
    });

    test("returns the lowest uid the organization has never used", () => {
        expect(allocateSandboxUid("org-1", [UID_BASE, UID_BASE + 1])).toBe(UID_BASE + 2);
        // Gaps left by uids that were never assigned are still available.
        expect(allocateSandboxUid("org-1", [UID_BASE + 1])).toBe(UID_BASE);
    });

    test("never reuses a departed agent's uid", () => {
        // The caller passes every uid ever assigned, archived agents included, so
        // a leftover file can never become readable by whoever comes next.
        const everAssigned = [UID_BASE, UID_BASE + 1, UID_BASE + 2];
        expect(allocateSandboxUid("org-1", everAssigned)).toBe(UID_BASE + 3);
    });

    test("throws once the pool is spent", () => {
        const all = Array.from({ length: UID_POOL_SIZE }, (_, i) => UID_BASE + i);
        expect(() => allocateSandboxUid("org-1", all)).toThrow(SandboxUidPoolExhaustedError);
        try {
            allocateSandboxUid("org-1", all);
        } catch (error) {
            expect((error as SandboxUidPoolExhaustedError).code).toBe("UID_POOL_EXHAUSTED");
            expect((error as Error).message).toContain("rebuild the sandbox image");
        }
    });
});

describe("isUidInPool", () => {
    test("matches the pool baked into the image", () => {
        expect(isUidInPool(UID_BASE)).toBe(true);
        expect(isUidInPool(UID_BASE + UID_POOL_SIZE - 1)).toBe(true);
        expect(isUidInPool(UID_BASE + UID_POOL_SIZE)).toBe(false);
        expect(isUidInPool(0)).toBe(false);
        expect(isUidInPool(1.5)).toBe(false);
    });
});
