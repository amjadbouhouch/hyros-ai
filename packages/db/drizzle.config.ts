import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for the Hyros AI database.
 *
 * Dialect: PostgreSQL. Drizzle owns the public/app schema; Supabase owns
 * `auth.*` (see agent-os-architecture.md §4).
 *
 * - `generate` reads only `schema`/`out` and needs no live DB connection.
 * - `push`/`migrate`/`studio` connect using `DATABASE_URL`, which the Bun
 *   runtime auto-loads from `.env`. The fallback below keeps `generate`
 *   usable without one.
 * - Managed Postgres (Supabase, etc.) requires SSL; local dev does not.
 *   We detect from the URL so both work without extra config.
 */
const url =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/hyros";

const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].some((h) =>
    url.includes(h),
);

export default defineConfig({
    dialect: "postgresql",
    schema: "./src/schema.ts",
    out: "./migrations",
    dbCredentials: {
        url,
        ssl: isLocal ? false : "require",
    },
    verbose: true,
    strict: true,
});
