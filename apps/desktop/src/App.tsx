import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "@hyros-ai/ui";
import { api } from "@hyros-ai/api-client";

import {
    getPendingAuthUrl,
    getSession,
    handleAuthCallback,
    onAuthCallback,
    signInWithGoogle,
    signOut,
} from "./lib/auth.js";

interface SessionUser {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
}

const container: React.CSSProperties = {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 480,
    margin: "0 auto",
    padding: "3rem 1rem",
    textAlign: "center",
};

export function App() {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        void restoreSession();

        // Verify the Tauri IPC bridge (optional diagnostic).
        invoke<string>("greet", { name: "Hyros" }).catch(() => {
            /* non-fatal */
        });

        // Handle the Google OAuth deep-link callback (hyros://auth/callback)
        // while the app is running.
        const processUrl = (url: string) => {
            void handleAuthCallback(url)
                .then(() => restoreSession())
                .catch((e) => setError(e instanceof Error ? e.message : String(e)));
        };

        let unlisten: UnlistenFn | undefined;
        void onAuthCallback(processUrl).then((u) => {
            unlisten = u;
        });

        // Cold start: the deep link may have LAUNCHED the app, arriving before
        // the JS listener existed. Drain the URL the plugin stored for us.
        void getPendingAuthUrl()
            .then((url) => {
                if (url) processUrl(url);
            })
            .catch(() => {
                /* deep-link plugin unavailable — non-fatal */
            });

        return () => {
            void unlisten?.();
        };
    }, []);

    async function restoreSession() {
        setLoading(true);
        setError(null);
        try {
            const session = await getSession();
            if (!session) {
                setUser(null);
                return;
            }
            // Validate via the gateway and load the app-level profile.
            console.log("[app] calling gateway /auth/session…");
            const { data, error: apiErr } = await api.auth.session.get({
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (apiErr) {
                console.error(
                    "[app] /auth/session failed:",
                    apiErr.status,
                    apiErr.value,
                );
                throw apiErr;
            }
            console.log("[app] /auth/session OK — user loaded:", data);
            setUser(data as SessionUser);
        } catch (e) {
            // Invalid/expired session — drop it.
            console.error("[app] restoreSession failed:", e);
            setUser(null);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    async function handleLogin() {
        setBusy(true);
        setError(null);
        try {
            console.log("[app] Sign in with Google clicked");
            await signInWithGoogle();
            // In dev, sign-in completes inline (gateway poll); reload the
            // session from the keychain. In prod this is a harmless no-op —
            // the deep-link callback triggers restoreSession later.
            console.log("[app] sign-in flow finished — restoring session…");
            await restoreSession();
        } catch (e) {
            console.error("[app] sign-in failed:", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function handleLogout() {
        setBusy(true);
        setError(null);
        try {
            await signOut();
            setUser(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    if (loading) {
        return <div style={container}>Loading…</div>;
    }

    return (
        <div style={container}>
            <h1>Hyros AI</h1>
            {error && <p style={{ color: "crimson" }}>{error}</p>}

            {user ? (
                <div>
                    {user.avatarUrl ? (
                        <img
                            src={user.avatarUrl}
                            alt={user.name}
                            width={72}
                            height={72}
                            style={{ borderRadius: "50%" }}
                        />
                    ) : (
                        <div
                            style={{
                                width: 72,
                                height: 72,
                                margin: "0 auto",
                                borderRadius: "50%",
                                background: "#e2e8f0",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "2rem",
                            }}
                        >
                            {user.name.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <h2>{user.name}</h2>
                    <p style={{ color: "#64748b" }}>{user.email}</p>
                    <Button onClick={() => void handleLogout()} disabled={busy} variant="secondary">
                        Sign out
                    </Button>
                </div>
            ) : (
                <div>
                    <p style={{ color: "#64748b" }}>Sign in to continue</p>
                    <Button onClick={() => void handleLogin()} disabled={busy} size="lg">
                        Sign in with Google
                    </Button>
                </div>
            )}
        </div>
    );
}