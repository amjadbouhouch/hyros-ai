import { Elysia } from "elysia";
import { supabaseAdmin } from "../lib/supabase.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("auth");

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
}

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
        const path = new URL(request.url).pathname;
        const token = extractBearer(headers.authorization);
        if (!token) {
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
    .onBeforeHandle({ as: "scoped" }, ({ user, set, request }) => {
        if (!user) {
            log.warn("rejecting request with 401", {
                method: request.method,
                path: new URL(request.url).pathname,
            });
            set.status = 401;
            return { error: "Unauthorized" };
        }
    });