/**
 * Web chat wiring: the shared createHyrosChat() controller with web defaults —
 * no auth headers yet (dev requests fall through to the gateway's DEV_USER_ID
 * escape) and the browser's native EventSource.
 */

import { createHyrosChat } from "@hyros-ai/react-query";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:3000";

export const hyrosChat = createHyrosChat({ baseUrl: GATEWAY_URL });

export const useHyrosChat = hyrosChat.useHyrosChat;
export const resetHyrosChat = hyrosChat.resetHyrosChat;
