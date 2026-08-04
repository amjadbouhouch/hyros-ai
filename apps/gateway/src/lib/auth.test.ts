import { mock, test, expect, beforeEach } from "bun:test";

// ── Mock supabase admin so tests never hit the network or need env vars ──
const getUserMock = mock<(token: string) => Promise<{ data: { user: any }; error: any }>>();

await mock.module("./supabase.js", () => ({
    supabaseAdmin: { auth: { getUser: getUserMock } },
}));

import type { AuthUser } from "./auth.js";
const { authGuard } = await import("./auth.js");
const { Elysia } = await import("elysia");

// Minimal test app: one protected route that uses the guard and echoes the user
// ponytail: Elysia .use() doesn't propagate derive types to route handlers in TS
// inference — runtime is correct (tests pass), `any` for the compiler.
const testApp = new Elysia()
    .use(authGuard)
    .get("/me", ({ user }: any) => user as AuthUser);

beforeEach(() => {
    getUserMock.mockReset();
});

// Slice 1: no auth header → 401
test("returns 401 without Authorization header", async () => {
    const res = await testApp.handle(new Request("http://localhost/me"));
    expect(res.status).toBe(401);
});

// Slice 2: invalid token → 401
test("returns 401 with an invalid token", async () => {
    getUserMock.mockResolvedValueOnce({
        data: { user: null },
        error: { message: "invalid token" },
    });
    const res = await testApp.handle(
        new Request("http://localhost/me", {
            headers: { Authorization: "Bearer bad-token" },
        }),
    );
    expect(res.status).toBe(401);
    // supabase.auth.getUser must have been called with the raw token
    expect(getUserMock).toHaveBeenCalledWith("bad-token");
});

// Slice 3: valid token → 200 + user mapped from Supabase
test("returns 200 with mapped user for a valid token", async () => {
    getUserMock.mockResolvedValueOnce({
        data: {
            user: {
                id: "supa-123",
                email: "test@example.com",
                user_metadata: {
                    full_name: "Test User",
                    avatar_url: "https://img.example.com/a.png",
                },
            },
        },
        error: null,
    });
    const res = await testApp.handle(
        new Request("http://localhost/me", {
            headers: { Authorization: "Bearer valid-token" },
        }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthUser;
    expect(body).toEqual({
        id: "supa-123",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: "https://img.example.com/a.png",
    });
});
