import { Elysia } from "elysia";

import { authGuard } from "./guard.js";
import { upsertUser } from "./service.js";

/**
 * Auth route group — protected endpoints that require a valid Supabase JWT.
 *
 * Currently exposes `GET /auth/session` (the "/me" endpoint): returns the
 * authenticated user (from the guard) and upserts the profile to the Drizzle
 * `users` table so the app knows who the user is. The desktop calls this after
 * restoring a session to confirm validity and load the user object.
 *
 * Per agent-os-architecture.md §3 (Elysia = auth gate exposing identity).
 */
export const authRoutes = new Elysia({ name: "auth-routes" })
    .use(authGuard)
    .get(
    "/auth/session",
    async ({ user, set }) => {
        // Guard rejects null users (401), but TS can't narrow the type across
        // the plugin boundary. Unreachable at runtime when the guard is applied.
        if (!user) {
            set.status = 401;
            return { error: "Unauthorized" };
        }
        await upsertUser(user);
        return user;
    },
);