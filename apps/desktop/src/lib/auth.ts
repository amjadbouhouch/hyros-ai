import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase.js";

/**
 * Desktop Google OAuth flow for Tauri v2 (TASK-004) — system browser + deep link.
 *
 * The consent page always opens in the SYSTEM BROWSER (Chrome etc.) via the
 * `open_url` Rust command, where the user is typically already signed in to
 * Google — no re-typing credentials inside an embedded webview.
 *
 * Production (bundled `.app`):
 *   1. signInWithGoogle() → supabase.auth.signInWithOAuth (PKCE,
 *      skipBrowserRedirect) with redirectTo = hyros://auth/callback, then
 *      open_url() launches the consent page in Chrome.
 *   2. After consent, Supabase redirects to hyros://auth/callback?code=... —
 *      macOS routes it to the app (the `hyros` scheme is baked into the
 *      bundle's Info.plist from tauri.conf.json plugins.deep-link).
 *   3. tauri-plugin-deep-link emits `deep-link://new-url`; onAuthCallback →
 *      handleAuthCallback() exchanges the code (the PKCE verifier is still in
 *      the running Supabase client's memory) and persists the session to the
 *      OS keychain via Rust.
 *   4. Cold start (the deep link LAUNCHED the app): the plugin stores the URL
 *      before the JS listener exists; getPendingAuthUrl() drains it on mount
 *      via the plugin's `get_current` command.
 *
 * Dev (`tauri dev`): macOS only routes custom URL schemes to bundled .apps
 *   installed in /Applications, so the deep link can never reach a bare dev
 *   binary. Instead the browser is redirected to the gateway
 *   (/auth/oauth/callback/:pollId), which holds the one-time code until the app
 *   polls it back, then finishes the same PKCE exchange + keychain save.
 *
 * Per agent-os-architecture.md §9 (native needs: keychain, shell, deep-link).
 */

/** Step-by-step diagnostics — visible in the Tauri webview DevTools console. */
const log = (msg: string, ...data: unknown[]) =>
    console.log(`[auth] ${msg}`, ...data);
const logError = (msg: string, ...data: unknown[]) =>
    console.error(`[auth] ${msg}`, ...data);

/**
 * Rejects with `message` if `promise` doesn't settle within `ms`. Turns silent
 * hangs (e.g. a macOS Keychain prompt waiting unseen, or a stuck network
 * request) into a visible UI error instead of "nothing happens".
 */
function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
): Promise<T> {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() =>
        window.clearTimeout(timer),
    );
}

/**
 * Gateway base URL — used by the dev-mode OAuth flow to receive the callback
 * and poll for the code. Mirrors the default in @hyros-ai/api-client.
 */
const GATEWAY_URL =
    import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:3000";

/** The deep-link event emitted by tauri-plugin-deep-link on every platform. */
const DEEP_LINK_EVENT = "deep-link://new-url";

/**
 * The current Supabase access token, mirrored for sync readers (the chat
 * container's EventSource factory can't await). Kept in sync by the auth
 * state listener + explicit sets in the session paths below.
 */
let currentAccessToken: string | null = null;

/** Sync access to the current access token (chat SSE + API headers). */
export function getAccessToken(): string | null {
    return currentAccessToken;
}

// Single listener covers sign-in, sign-out, and token refresh.
supabase.auth.onAuthStateChange((_event, session) => {
    currentAccessToken = session?.access_token ?? null;
});

/**
 * Authorization codes are single-use, and the plugin can surface the same deep
 * link twice (runtime event + `get_current` on mount). Track codes we've
 * already exchanged so duplicates are ignored instead of erroring.
 */
const handledCodes = new Set<string>();

/**
 * Start the Google OAuth flow — opens the system browser (Chrome).
 *
 * Production: after consent, Supabase redirects to hyros://auth/callback and
 * the deep link brings the code back to the app (see onAuthCallback /
 * getPendingAuthUrl). Dev: gateway callback + polling instead (see above).
 */
export async function signInWithGoogle(): Promise<void> {
    if (import.meta.env.DEV) return signInWithGoogleDev();

    log("starting production OAuth flow (deep link hyros://auth/callback)");
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: "hyros://auth/callback",
            skipBrowserRedirect: true,
        },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("No OAuth URL returned from Supabase");
    await invoke("open_url", { url: data.url });
}

/** Dev-mode OAuth: gateway callback + polling instead of the deep link. */
async function signInWithGoogleDev(): Promise<void> {
    const pollId = crypto.randomUUID();
    log("starting dev OAuth flow (gateway bridge)", {
        pollId,
        gateway: GATEWAY_URL,
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: `${GATEWAY_URL}/auth/oauth/callback/${pollId}`,
            skipBrowserRedirect: true,
        },
    });
    if (error) {
        logError("signInWithOAuth failed:", error);
        throw error;
    }
    if (!data?.url) throw new Error("No OAuth URL returned from Supabase");
    log("OAuth URL created — opening the system browser…");
    await invoke("open_url", { url: data.url });

    // The app never reloads during this flow, so the PKCE code_verifier
    // generated by signInWithOAuth is still in memory when we exchange.
    log("browser opened — polling the gateway for the auth code…");
    const code = await pollForCode(pollId);
    log("auth code received — exchanging it for a session (PKCE)…");

    const { data: session, error: exchangeError } = await withTimeout(
        supabase.auth.exchangeCodeForSession(code),
        20_000,
        "Timed out exchanging the auth code with Supabase (no response in 20s).",
    );
    if (exchangeError || !session.session) {
        logError("code exchange failed:", exchangeError);
        throw exchangeError ?? new Error("No session returned");
    }
    log("exchange OK — signed in as", session.session.user.email);

    log("saving the session to the OS keychain…");
    await withTimeout(
        invoke("save_session", { session: JSON.stringify(session.session) }),
        20_000,
        "Timed out saving to the keychain — is a macOS Keychain permission prompt waiting behind a window?",
    );
    log("session saved to keychain — dev sign-in complete");
}

/** Poll the gateway until the OAuth code for pollId arrives (or timeout). */
async function pollForCode(
    pollId: string,
    timeoutMs = 120_000,
): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
        attempt += 1;
        try {
            const res = await fetch(
                `${GATEWAY_URL}/auth/oauth/poll/${pollId}`,
            );
            log(`poll #${attempt}: gateway responded ${res.status}`);
            if (res.ok) {
                const body = (await res.json()) as { code?: string | null };
                if (body.code) return body.code;
            }
        } catch (e) {
            // Gateway not reachable yet — keep polling.
            log(`poll #${attempt}: gateway unreachable, retrying…`, e);
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error(
        "Sign-in timed out waiting for the browser. Please try again.",
    );
}

/**
 * Process a deep-link callback URL (hyros://auth/callback?code=...).
 * Exchanges the auth code for a session and persists it to the keychain.
 *
 * Returns the session on success, null when the URL was a duplicate delivery
 * of an already-handled code. Throws on missing code or exchange failure.
 */
export async function handleAuthCallback(
    url: string,
): Promise<Session | null> {
    const code = new URL(url).searchParams.get("code");
    if (!code) throw new Error("No auth code in callback URL");

    // Codes are single-use; the plugin can deliver the same URL via both the
    // `deep-link://new-url` event and `get_current`. Ignore duplicates.
    if (handledCodes.has(code)) return null;
    handledCodes.add(code);

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) throw error ?? new Error("No session returned");

    await invoke("save_session", { session: JSON.stringify(data.session) });
    return data.session;
}

/**
 * Drain the deep link that launched the app (cold start). On macOS the plugin
 * receives the URL via `RunEvent::Opened` before the JS listener is attached
 * and stores it; `get_current` returns it. Returns null when the app was
 * started normally.
 */
export async function getPendingAuthUrl(): Promise<string | null> {
    const urls = await invoke<string[] | null>("plugin:deep-link|get_current");
    return (
        urls?.find((url) => url.startsWith("hyros://auth/callback")) ?? null
    );
}

/**
 * Restore the session from the keychain on app start.
 * Returns null if no session is stored (first launch / signed out).
 */
export async function getSession(): Promise<Session | null> {
    log("getSession: reading the keychain…");
    const stored = await invoke<string | null>("get_session");
    if (!stored) {
        log("getSession: no session stored (first launch / signed out)");
        return null;
    }
    log("getSession: session found in keychain — restoring into Supabase…");

    const parsed = JSON.parse(stored) as {
        access_token: string;
        refresh_token: string;
    };

    const { data, error } = await supabase.auth.setSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
    });
    if (error || !data.session) {
        logError("getSession: setSession failed:", error);
        return null;
    }
    currentAccessToken = data.session.access_token;
    log("getSession: session restored for", data.session.user.email);
    return data.session;
}

/** Sign out — clears the keychain and the Supabase client. */
export async function signOut(): Promise<void> {
    currentAccessToken = null;
    await invoke("clear_session");
    await supabase.auth.signOut();
}

/**
 * Listen for deep-link events (hyros://auth/callback) while the app is
 * running. The plugin emits a JSON array of URLs on `deep-link://new-url`.
 * Call this once on app start; the returned unlisten function should be called
 * on cleanup.
 */
export function onAuthCallback(
    cb: (url: string) => void,
): Promise<UnlistenFn> {
    return listen<string[]>(DEEP_LINK_EVENT, (event) => {
        for (const url of event.payload) {
            if (url.startsWith("hyros://auth/callback")) cb(url);
        }
    });
}