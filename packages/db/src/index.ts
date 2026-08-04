/**
 * Hyros AI database package — Drizzle ORM (Postgres).
 *
 * Owns the public/app schema: users, organizations, organization_memberships.
 * Supabase owns `auth.*` (auth + SSO); this package only stores app-level data
 * keyed by the Supabase auth user id. See agent-os-architecture.md §2/§4.
 */
export { db, type DB } from "./client.js";
export * from "./schema.js";
