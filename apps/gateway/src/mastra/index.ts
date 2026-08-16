import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { PinoLogger } from '@mastra/loggers';
import { supportAgent } from "./agents/support-agent";
import { dynamicAgentScheduleWorkflow } from "./workflows/dynamic-agent-schedule.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        "DATABASE_URL is not set. Add it to your .env (see .env.example).",
    );
}

// Mirror @hyros-ai/db client.ts: managed Postgres (Supabase pooler) requires
// TLS, local dev Postgres typically doesn't. Detect from the URL so both work.
// Note: pg's ssl is `boolean | ConnectionOptions` — there is no "require"
// string (that's postgres.js). `{ rejectUnauthorized: false }` is the pg
// equivalent of postgres.js's `ssl: "require"` (enforce TLS, skip chain
// verification). `prepare: false` from db/client.ts is also postgres.js-only;
// pg never auto-prepares statements, so nothing to mirror here.
const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].some((h) =>
    databaseUrl.includes(h),
);

/**
 * The central Mastra instance for the Hyros AI gateway.
 *
 * Registered here are all Mastra agents (and, in the future, workflows, tools,
 * memory, etc.). This instance is consumed in-process by the Mastra Hono server
 * (`./server.ts`), whose `.fetch` handler Elysia mounts at `/mastra` — exposing
 * the full agent REST surface (`/mastra/api/agents`,
 * `/mastra/api/agents/:id/generate`, …).
 *
 * Storage: PostgresStore on the same DATABASE_URL as Drizzle (@hyros-ai/db) —
 * both planes share one Postgres. Mastra calls storage.init() on boot, which
 * creates the `mastra_*` tables in the public schema. (Replaced the POC
 * LibSQLStore `file:./mastra.db` — that file is left in place, unused.)
 */
export const mastra = new Mastra({
    workflows: { dynamicAgentScheduleWorkflow },
    agents: { supportAgent },
    scorers: {},
    storage: new PostgresStore({
        id: "mastra-storage",
        connectionString: databaseUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
    }),
    logger: new PinoLogger({
        name: 'Mastra',
        level: 'info',
    }),
    // backgroundTasks: {
    //   enabled: true,
    //   globalConcurrency: 10,
    //   perAgentConcurrency: 5,
    //   backpressure: 'queue',
    //   defaultTimeoutMs: 300_000,
    //   onTaskComplete(task) {
    //     console.log(`[onTaskComplete]: taskId=${task.id}`)
    //   },
    // },
    //   observability: new Observability({
    //     configs: {
    //       default: {
    //         serviceName: 'mastra',
    //         exporters: [
    //           new MastraStorageExporter(), // Persists observability events to Mastra Storage
    //           new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
    //         ],
    //         spanOutputProcessors: [
    //           new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
    //         ],
    //       },
    //     },
    //   }),
});
