import { Elysia } from "elysia";
import { supabaseAdmin } from "./supabase.js";

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
    .resolve({ as: "scoped" }, async ({ headers }) => {
        const token = extractBearer(headers.authorization);
        if (!token) return { user: null };
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !data.user) return { user: null };
        return { user: mapUser(data.user) };
    })
    .onBeforeHandle({ as: "scoped" }, ({ user, set }) => {
        if (!user) {
            set.status = 401;
            return { error: "Unauthorized" };
        }
    });
