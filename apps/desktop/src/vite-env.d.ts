/// <reference types="vite/client" />

/**
 * Typed Vite env vars for the Hyros desktop (Tauri) client.
 *
 * Only `VITE_`-prefixed vars are exposed to the bundle (see
 * `apps/desktop/vite.config.ts` `envPrefix`). The service-role key is
 * intentionally NOT here — the desktop only ever holds the public anon key;
 * the gateway holds the service-role key. See `docs/auth-supabase-setup.md`
 * and `agent-os-architecture.md` §4.
 */
interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    /** Optional gateway override (defaults to http://localhost:3000). */
    readonly VITE_GATEWAY_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}