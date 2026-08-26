/**
 * Desktop chat wiring: the shared createHyrosChat() controller from
 * @hyros-ai/react-query with the desktop platform seams injected. The store is
 * a module singleton (one EventSource fan-out per agent, shared by every hook
 * consumer). SSE can't carry headers in browsers, so the access token rides
 * the ?token= query param (gateway guard accepts it); POST /chat uses a Bearer
 * header. Dev fallback: no token → the gateway's DEV_USER_ID.
 */

import { createHyrosChat } from "@hyros-ai/react-query";

import { getAccessToken } from "./auth.js";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:3000";

const hyrosChat = createHyrosChat({
    baseUrl: GATEWAY_URL,
    getHeaders: (): Record<string, string> => {
        const token = getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    },
    sseUrl: (url) => {
        const eventsUrl = new URL(url);
        eventsUrl.searchParams.set("token", getAccessToken() ?? "");
        return eventsUrl.toString();
    },
});

export const useHyrosChat = hyrosChat.useHyrosChat;
export const resetHyrosChat = hyrosChat.resetHyrosChat;
