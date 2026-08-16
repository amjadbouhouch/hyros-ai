import { Elysia } from "elysia";
import type { UserProfile } from "@hyros-ai/domain";

import { supabaseAdmin } from "../lib/supabase.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("auth");

/**
 * The authenticated user attached to the request context by the guard.
 * The shape lives in @hyros-ai/domain (single source of truth shared with all
 * clients); this alias keeps the gateway's internal naming stable.
 */
export type AuthUser = UserProfile;

function extractBearer(header: string | undefined): string | null {
    if (!header?.startsWith("Bearer ")) return null;
    return header.slice(7);
}

function mapUser(u: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
}): AuthUser {
    return {
        id: u.id,
        email: u.email ?? "",
        name: (u.user_metadata?.full_name as string) ?? u.email ?? "",
        avatarUrl: (u.user_metadata?.avatar_url as string) ?? null,
    };
}

/**
 * Elysia guard plugin — verifies the Supabase JWT (Bearer header) and attaches
 * the authenticated user to the request context. Returns 401 on missing/invalid
 * token. Opt-in: only routes that `.use(authGuard)` are protected; /health and
 * /mastra stay public by not using it. Per agent-os-architecture.md §3/§4.
 */
export const authGuard = new Elysia({ name: "auth-guard" })
    .resolve({ as: "scoped" }, async ({ headers, request }) => {
        const url = new URL(request.url);
        const path = url.pathname;
        // Bearer header, or ?token= for transports that can't set headers
        // (browser EventSource on the SSE routes). Same verification either way.
        const token =
            extractBearer(headers.authorization) ?? url.searchParams.get("token");
        if (!token) {
            // ponytail: dev-only identity so the unauthenticated web preview can
            // call guarded routes (web auth hasn't landed). Env-gated — never
            // set DEV_USER_ID outside local dev; in prod this branch is dead.
            const devId =
                process.env.NODE_ENV === "development"
                    ? process.env.DEV_USER_ID
                    : undefined;
            if (devId) {
                return {
                    user: {
                        id: devId,
                        email: "dev@hyros.local",
                        name: "Dev User",
                        avatarUrl: null,
                    },
                };
            }
            log.debug("no bearer token", { path });
            return { user: null };
        }
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !data.user) {
            log.warn("token rejected by Supabase", {
                path,
                error: error?.message ?? "no user returned",
            });
            return { user: null };
        }
        const user = mapUser(data.user);
        log.info("authenticated", { path, email: user.email });
        return { user };
    })
    .onBeforeHandle({ as: "scoped" }, ({ user, status, request }) => {
        if (!user) {
            log.warn("rejecting request with 401", {
                method: request.method,
                path: new URL(request.url).pathname,
            });
            return status(401, { error: "Unauthorized" });
        }
    });
