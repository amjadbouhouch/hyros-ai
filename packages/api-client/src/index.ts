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
export type ApiClient = Treaty.Create<App>;

export function createApiClient(
    baseUrl: string = GATEWAY_URL,
    config: Treaty.Config = {},
): ApiClient {
    return treaty<App>(baseUrl, config);
}

export const api: ApiClient = createApiClient();

/** HTTP contract types are inferred from the gateway's exported Elysia App. */
export type AgentsResponse = Treaty.Data<ApiClient["agents"]["get"]>;
export type AgentSummary = AgentsResponse extends Array<infer Item> ? Item : never;
export type ArchiveAgentResponse = Treaty.Data<
    ReturnType<ApiClient["agents"]>["archive"]["patch"]
>;
export type AgentSchedulesResponse = Treaty.Data<
    ReturnType<ApiClient["agents"]>["schedules"]["get"]
>;
export type ChatMessagesResponse = Treaty.Data<
    ReturnType<ApiClient["chat"]>["messages"]["get"]
>;
export type ChatPostBody = NonNullable<Parameters<ApiClient["chat"]["post"]>[0]>;

export type { App, ChatEvent, ChatEventMap } from "@hyros-ai/gateway";
