import { mock, test, expect, beforeEach } from "bun:test";
import { AuthError } from "@supabase/supabase-js";
import type { UserResponse } from "@supabase/supabase-js";

// ── Mock supabase admin (for the auth guard) ──
const getUserMock = mock<(token: string) => Promise<UserResponse>>();

await mock.module("../lib/supabase.js", () => ({
    supabaseAdmin: { auth: { getUser: getUserMock } },
}));

// ── Mock db (for upsertUser) ──
const onConflictDoUpdate = mock(() => Promise.resolve());
const values = mock(() => ({ onConflictDoUpdate }));
const insert = mock(() => ({ values }));

await mock.module("../lib/db.js", () => ({ db: { insert } }));

const { authRoutes } = await import("./routes.js");
const { Elysia } = await import("elysia");

const testApp = new Elysia().use(authRoutes);

beforeEach(() => {
    getUserMock.mockReset();
    insert.mockClear();
    values.mockClear();
    onConflictDoUpdate.mockClear();
});

function mockValidUser() {
    getUserMock.mockResolvedValueOnce({
        data: {
            user: {
                id: "supa-123",
                email: "test@example.com",
                user_metadata: {
                    full_name: "Test User",
                    avatar_url: "https://img.example.com/a.png",
                },
                app_metadata: {},
                aud: "authenticated",
                created_at: "2025-01-01T00:00:00Z",
            },
        },
        error: null,
    });
}

// Slice 1: 401 without auth (guard rejects)
test("GET /auth/session returns 401 without Authorization header", async () => {
    const res = await testApp.handle(
        new Request("http://localhost/auth/session"),
    );
    expect(res.status).toBe(401);
});

// Slice 2: 200 + returns user + upserts to db
test("GET /auth/session returns user and upserts profile", async () => {
    mockValidUser();
    const res = await testApp.handle(
        new Request("http://localhost/auth/session", {
            headers: { Authorization: "Bearer valid-token" },
        }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
        id: "supa-123",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: "https://img.example.com/a.png",
    });
    // upsertUser was called (insert → values → onConflictDoUpdate)
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
        id: "supa-123",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: "https://img.example.com/a.png",
    });
});