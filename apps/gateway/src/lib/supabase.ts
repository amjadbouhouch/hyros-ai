import { createClient } from "@supabase/supabase-js";

/**
 * Gateway-side Supabase client (service-role / admin) — **server-only**.
 *
 * This module must never be imported into the desktop (or any client) bundle:
 * it carries the service-role key, which bypasses Row-Level Security. The
 * desktop uses its own browser client with the public anon key
 * (`apps/desktop/src/lib/supabase.ts`). Per `agent-os-architecture.md` §4.
 *
 * The auth middleware (TASK-003) uses this to verify Supabase access tokens
 * (`supabase.auth.getUser(token)`) and, later, to upsert app user profiles
 * (TASK-005). Sessions are not persisted server-side and the token is never
 * auto-refreshed — each request carries the user's own JWT.
 *
 * Throws at import time if the env vars are missing, so misconfiguration fails
 * fast. Nothing in the gateway imports this until TASK-003 wires it up, so the
 * server still boots without Supabase configured for now.
 */
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
        "Supabase env vars are not set. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your .env (see .env.example and docs/auth-supabase-setup.md).",
    );
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});