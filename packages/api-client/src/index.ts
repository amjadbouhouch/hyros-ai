import { treaty, type Treaty } from "@elysiajs/eden";
import type { App } from "@hyros-ai/gateway";

/**
 * The gateway base URL. In dev this defaults to the local Elysia server.
 * Override with VITE_GATEWAY_URL / TAURI_GATEWAY_URL / GATEWAY_URL as needed.
 */
const GATEWAY_URL =
    (typeof import.meta !== "undefined" &&
        (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
            ?.VITE_GATEWAY_URL) ||
    (typeof process !== "undefined" && process.env?.GATEWAY_URL) ||
    "http://localhost:3000";

/**
 * Eden Treaty client — fully typed against the Elysia `App`.
 * No codegen step: the type is imported directly from @hyros-ai/gateway.
 *
 * @example
 * const { data, error } = await api.health.get();
 * const { data } = await api.user({ id: "1" }).get();
 */
export const api: Treaty.Create<App> = treaty<App>(GATEWAY_URL);

export type { App } from "@hyros-ai/gateway";