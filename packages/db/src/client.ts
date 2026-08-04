import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        "DATABASE_URL is not set. Add it to your .env (see .env.example).",
    );
}

// Managed Postgres providers (Supabase, Neon, etc.) require SSL, while local
// dev Postgres typically doesn't support it. Detect from the URL so both work
// without extra config.
const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].some((h) =>
    databaseUrl.includes(h),
);

const queryClient = postgres(databaseUrl, {
    ssl: isLocal ? false : "require",
    // Supabase's PgBouncer transaction-mode pooler (port 6543) doesn't support
    // prepared statements. Disabling prepare keeps the client compatible with
    // both the direct connection (5432) and the pooler (6543). The per-query
    // perf cost is negligible for this app's load.
    prepare: false,
});

/**
 * The Drizzle ORM instance, with the full Hyros schema bound. Import this from
 * `@hyros-ai/db` in the gateway (and, later, hand the same `DATABASE_URL` to
 * Mastra's `@mastra/pg` storage so both planes share one Postgres — §4/§12).
 */
export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
