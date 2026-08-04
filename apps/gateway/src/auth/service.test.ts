import { mock, test, expect, beforeEach } from "bun:test";

// ── Mock db with a chainable Drizzle insert().values().onConflictDoUpdate() ──
const onConflictDoUpdate = mock(() => Promise.resolve());
const values = mock(() => ({ onConflictDoUpdate }));
const insert = mock(() => ({ values }));

await mock.module("../lib/db.js", () => ({ db: { insert } }));

import type { AuthUser } from "./guard.js";
const { upsertUser } = await import("./service.js");

beforeEach(() => {
    insert.mockClear();
    values.mockClear();
    onConflictDoUpdate.mockClear();
});

// Slice 1: inserts with correct user data
test("upsertUser inserts the user with id/email/name/avatarUrl", async () => {
    const user: AuthUser = {
        id: "supa-123",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: "https://img.example.com/a.png",
    };
    await upsertUser(user);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
        id: "supa-123",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: "https://img.example.com/a.png",
    });
});

// Slice 2: on conflict, updates email/name/avatarUrl + bumps updatedAt
test("upsertUser updates email/name/avatarUrl on conflict", async () => {
    const user: AuthUser = {
        id: "supa-123",
        email: "updated@example.com",
        name: "Updated User",
        avatarUrl: null,
    };
    await upsertUser(user);

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const calls = onConflictDoUpdate.mock.calls as unknown as [[{ set: Record<string, unknown> }]];
    const { set } = calls[0][0];
    expect(set).toMatchObject({
        email: "updated@example.com",
        name: "Updated User",
        avatarUrl: null,
    });
    expect(set.updatedAt).toBeInstanceOf(Date);
});