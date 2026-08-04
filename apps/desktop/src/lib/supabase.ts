import { createClient } from "@supabase/supabase-js";

/**
 * Desktop (browser/Tauri) Supabase client — **anon key only**.
 *
 * This is the only Supabase credential the desktop ever holds: the public anon
 * key, which is safe to ship because Row-Level Security enforces all access.
 * The service-role key never leaves the gateway (`apps/gateway/src/lib/supabase.ts`).
 * Per `agent-os-architecture.md` §4/§9.
 *
 * PKCE flow is enabled so the Google sign-in (TASK-004) can exchange the
 * `hyros://auth/callback` deep-link authorization code for a session. The
 * resulting access_token (JWT) is sent to the gateway as a Bearer token, where
 * the gateway verifies it (TASK-003) and returns the user via `/auth/session`.
 *
 * Supabase's own session storage is disabled here — TASK-004 persists the
 * session via a Rust keychain command (so no creds leak to localStorage). Until
 * then the client is importable but stateless.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        "Supabase env vars are not set. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to apps/desktop/.env (see apps/desktop/.env.example and docs/auth-supabase-setup.md).",
    );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        flowType: "pkce",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
    },
});