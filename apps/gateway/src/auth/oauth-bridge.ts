import { Elysia } from "elysia";

import { createLogger } from "../lib/logger.js";

const log = createLogger("oauth");

/**
 * Dev-mode OAuth bridge.
 *
 * macOS only routes custom URL schemes (hyros://) to bundled apps, so a bare
 * `tauri dev` binary can never receive the Google OAuth deep-link callback.
 * To keep login testable in dev, the desktop redirects the browser to
 * `GET /auth/oauth/callback/:pollId` here; we hold the one-time authorization
 * code in memory and hand it back when the desktop polls
 * `GET /auth/oauth/poll/:pollId`. The desktop then finishes the standard PKCE
 * exchange client-side (it holds the code_verifier).
 *
 * These routes are public (the user has no JWT yet — they are mid-login), but
 * the pollId is a random UUID and each code is single-use and short-lived,
 * which is appropriate for a localhost gateway.
 */
const pendingCodes = new Map<string, { code: string; createdAt: number }>();
const CODE_TTL_MS = 5 * 60 * 1000;

function pruneExpired(now: number): void {
    for (const [pollId, entry] of pendingCodes) {
        if (now - entry.createdAt > CODE_TTL_MS) {
            pendingCodes.delete(pollId);
            log.debug("pruned expired code", {
                pollId,
                ageMs: now - entry.createdAt,
            });
        }
    }
}

export const oauthBridge = new Elysia({ name: "oauth-bridge" })
    .get("/auth/oauth/callback/:pollId", ({ params, query, set }) => {
        const code = query.code;
        if (params.pollId && typeof code === "string" && code.length > 0) {
            pruneExpired(Date.now());
            pendingCodes.set(params.pollId, { code, createdAt: Date.now() });
            log.info("callback: code stored, waiting for desktop poll", {
                pollId: params.pollId,
                pending: pendingCodes.size,
            });
        } else {
            // Supabase lands here with ?error=… when the provider flow fails —
            // surface it so a misconfigured redirect URL is visible in logs.
            log.warn("callback: missing pollId or code", {
                pollId: params.pollId ?? null,
                hasCode: typeof code === "string" && code.length > 0,
                error: query.error ?? null,
                errorDescription: query.error_description ?? null,
            });
        }
        set.headers["content-type"] = "text/html; charset=utf-8";
        return [
            "<!doctype html><html><body style=\"font-family:system-ui,sans-serif;display:flex;",
            "align-items:center;justify-content:center;height:100vh;margin:0\">",
            "<div style=\"text-align:center\"><h2>You're signed in</h2>",
            "<p style=\"color:#64748b\">Close this tab and return to Hyros AI.</p></div>",
            "</body></html>",
        ].join("");
    })
    .get("/auth/oauth/poll/:pollId", ({ params, set }) => {
        const entry = pendingCodes.get(params.pollId);
        if (!entry) {
            // Fires every 750 ms while the user is in the browser — debug only.
            log.debug("poll: no code yet", { pollId: params.pollId });
            set.status = 404;
            return { code: null };
        }
        pendingCodes.delete(params.pollId); // single-use
        log.info("poll: code delivered to desktop (consumed)", {
            pollId: params.pollId,
            ageMs: Date.now() - entry.createdAt,
        });
        return { code: entry.code };
    });