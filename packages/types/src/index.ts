/**
 * Shared domain types and DTOs for the Hyros AI platform.
 * These are consumed by the gateway, web, desktop, and CLI.
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