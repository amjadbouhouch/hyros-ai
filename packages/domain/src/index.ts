/**
 * @hyros-ai/domain — shared domain types and DTOs for the Hyros AI platform.
 * This is the mobile-safe "domain" sharing scope: pure types only, no runtime,
 * no Bun/Node/DOM APIs. Consumed by the gateway, web, desktop, mobile, and CLI.
 */

export type ID = string;

export type ISODateString = string;

/** A user record as returned by the gateway. */
export interface User {
    id: ID;
    email: string;
    name: string;
    createdAt: ISODateString;
}

/** Health-check response shape. */
export interface HealthResponse {
    status: "ok" | "degraded";
    version: string;
    timestamp: ISODateString;
}