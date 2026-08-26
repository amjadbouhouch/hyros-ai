import { useEffect, useState } from "react";

import { api } from "@hyros-ai/api-client";
import type { UserProfile } from "@hyros-ai/domain";
import { MessagingApp } from "@hyros-ai/ui";

import { useHyrosChat } from "./lib/chat.js";

export function App() {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void restoreSession();
    }, []);

    async function restoreSession() {
        setLoading(true);
        setError(null);
        try {
            // Web sign-in is not wired yet: in dev the gateway answers
            // headerless requests as DEV_USER_ID; in prod this 401s.
            const { data, error: apiErr } = await api.auth.session.get();
            if (apiErr) throw apiErr;
            setUser(data as UserProfile);
        } catch (e) {
            setUser(null);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <main className="flex min-h-dvh items-center justify-center bg-background">
                <p className="text-sm text-muted-foreground">Loading…</p>
            </main>
        );
    }

    if (!user) {
        return (
            <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-6">
                <div className="flex flex-col items-center gap-4 text-center">
                    <h1 className="font-heading text-2xl font-semibold tracking-wider uppercase">
                        Hyros AI
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Web sign-in is not wired yet — run the gateway with
                        DEV_USER_ID set for the dev experience.
                    </p>
                </div>
                {error && (
                    <p className="max-w-md rounded-lg bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
                        {error}
                    </p>
                )}
            </main>
        );
    }

    return <SignedInApp user={user} />;
}

function SignedInApp({ user }: { user: UserProfile }) {
    const { chats, creating, createAgent, selectAgent, sendMessage, archiveAgent, loadSchedules } =
        useHyrosChat(user.id);
    return (
        <MessagingApp
            user={user}
            chats={chats}
            creating={creating}
            onCreateAgent={createAgent}
            onSendMessage={sendMessage}
            onSelectChat={selectAgent}
            onArchiveAgent={archiveAgent}
            onLoadSchedules={loadSchedules}
        />
    );
}
