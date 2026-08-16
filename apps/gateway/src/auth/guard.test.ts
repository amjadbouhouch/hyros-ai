import { mock, test, expect, beforeEach } from "bun:test";
import { AuthError } from "@supabase/supabase-js";
import type { UserResponse } from "@supabase/supabase-js";

// ── Mock supabase admin so tests never hit the network or need env vars ──
const getUserMock = mock<(token: string) => Promise<UserResponse>>();

await mock.module("../lib/supabase.js", () => ({
    supabaseAdmin: { auth: { getUser: getUserMock } },
}));

import type { AuthUser } from "./guard.js";
const { authGuard } = await import("./guard.js");
const { Elysia } = await import("elysia");

// Minimal test app: one protected route that uses the guard and echoes the user
const testApp = new Elysia()
    .use(authGuard)
    .get("/me", ({ user }) => user);

beforeEach(() => {
    getUserMock.mockReset();
});

// Slice 1: no auth header → 401
test("returns 401 without Authorization header", async () => {
    const res = await testApp.handle(new Request("http://localhost/me"));
    expect(res.status).toBe(401);
});

test("does not honor the development identity outside development", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDevUserId = process.env.DEV_USER_ID;
    process.env.NODE_ENV = "production";
    process.env.DEV_USER_ID = "00000000-0000-0000-0000-0000000000d1";
    try {
        const res = await testApp.handle(new Request("http://localhost/me"));
        expect(res.status).toBe(401);
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousDevUserId === undefined) delete process.env.DEV_USER_ID;
        else process.env.DEV_USER_ID = previousDevUserId;
    }
});

test("honors the configured development identity in development", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDevUserId = process.env.DEV_USER_ID;
    process.env.NODE_ENV = "development";
    process.env.DEV_USER_ID = "00000000-0000-0000-0000-0000000000d1";
    try {
        const res = await testApp.handle(new Request("http://localhost/me"));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
            id: "00000000-0000-0000-0000-0000000000d1",
            email: "dev@hyros.local",
        });
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousDevUserId === undefined) delete process.env.DEV_USER_ID;
        else process.env.DEV_USER_ID = previousDevUserId;
    }
});

// Slice 2: invalid token → 401
test("returns 401 with an invalid token", async () => {
    getUserMock.mockResolvedValueOnce({
        data: { user: null },
        error: new AuthError("invalid token"),
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
                app_metadata: {},
                aud: "authenticated",
                created_at: "2025-01-01T00:00:00Z",
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
