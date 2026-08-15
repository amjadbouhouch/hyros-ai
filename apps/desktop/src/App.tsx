import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Sparkles } from "lucide-react";

import { api } from "@hyros-ai/api-client";
import type { UserProfile } from "@hyros-ai/domain";
import { Button, MessagingApp } from "@hyros-ai/ui";

import {
    getPendingAuthUrl,
    getSession,
    handleAuthCallback,
    onAuthCallback,
    signInWithGoogle,
    signOut,
} from "./lib/auth.js";

export function App() {
    const [user, setUser] = useState<UserProfile | null>(null);
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
            setUser(data as UserProfile);
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
        return (
            <main className="flex min-h-dvh items-center justify-center bg-background">
                <p className="text-sm text-muted-foreground">Loading…</p>
            </main>
        );
    }

    // Signed out → sign-in screen.
    if (!user) {
        return (
            <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-6">
                <div className="flex flex-col items-center gap-4 text-center">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <Sparkles className="size-6" />
                    </span>
                    <div className="space-y-1.5">
                        <h1 className="font-heading text-2xl font-semibold tracking-wider uppercase">
                            Hyros AI
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Sign in to open your workspace
                        </p>
                    </div>
                </div>

                {error && (
                    <p className="max-w-md rounded-lg bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
                        {error}
                    </p>
                )}

                <Button size="lg" disabled={busy} onClick={() => void handleLogin()}>
                    {busy ? "Signing in…" : "Sign in with Google"}
                </Button>
            </main>
        );
    }

    // Signed in → the shared messaging workspace (web + desktop, from @hyros-ai/ui).
    return <MessagingApp user={user} onSignOut={() => void handleLogout()} />;
}