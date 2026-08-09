/**
 * @hyros-ai/client-runtime — auth session management.
 *
 * Platform-agnostic session logic shared by every client (web, desktop,
 * mobile). Each platform supplies a `SessionStore` (secure storage: OS
 * keychain, localStorage, expo-secure-store…); this module owns the policy:
 * restore → verify against the gateway → expose the profile; sign out → clear.
 *
 * Sharing-scope rules: no DOM, no Node/Bun APIs, no React — mobile-safe by
 * construction. Transport access is injected (`fetchProfile`), so this module
 * never constructs an API client itself.
 */

import type { UserProfile } from "@hyros-ai/domain";

/**
 * The minimal persisted session: what a client needs to talk to the gateway
 * (the Supabase access token, sent as a Bearer JWT) plus the refresh token
 * for rehydrating the auth client. Platform layers map to/from whatever shape
 * they physically store (e.g. the desktop keychain holds the full Supabase
 * session JSON).
 */
export interface StoredSession {
    accessToken: string;
    refreshToken: string;
}

/**
 * Platform seam for secure session storage (TASK-015 supplies the concrete
 * implementations). One per platform:
 *  - desktop (Tauri): OS keychain via Rust commands
 *  - web: localStorage / cookie
 *  - mobile (Expo): expo-secure-store
 */
export interface SessionStore {
    load(): Promise<StoredSession | null>;
    save(session: StoredSession): Promise<void>;
    clear(): Promise<void>;
}

/** Result of attempting to restore a session on app start. */
export type RestoreResult =
    /** No stored session — the user is signed out. */
    | { status: "signed-out" }
    /** Stored session verified against the gateway. */
    | { status: "signed-in"; profile: UserProfile }
    /**
     * A stored session exists but verification failed (gateway unreachable,
     * token rejected, …). Deliberately does NOT clear the store: a transient
     * network failure must not destroy a valid session. Call `signOut()` to
     * clear explicitly.
     */
    | { status: "error"; error: unknown };

export interface SessionManagerOptions {
    store: SessionStore;
    /**
     * Verify an access token against the gateway and return the profile.
     * Apps wire this to `api.auth.session.get` (Eden Treaty) with the token as
     * a Bearer header. Injected so this module stays transport-agnostic and
     * unit-testable.
     */
    fetchProfile(accessToken: string): Promise<UserProfile>;
}

export interface SessionManager {
    /** Restore and verify the persisted session (call once on app start). */
    restore(): Promise<RestoreResult>;
    /** Clear the persisted session (does not touch the auth provider). */
    signOut(): Promise<void>;
}

/**
 * Create the shared session manager. Apps call `restore()` on startup and
 * `signOut()` on logout; storage and transport are injected by the platform.
 */
export function createSessionManager(
    options: SessionManagerOptions,
): SessionManager {
    return {
        async restore() {
            const stored = await options.store.load();
            if (!stored) return { status: "signed-out" };
            try {
                const profile = await options.fetchProfile(stored.accessToken);
                return { status: "signed-in", profile };
            } catch (error) {
                return { status: "error", error };
            }
        },
        async signOut() {
            await options.store.clear();
        },
    };
}