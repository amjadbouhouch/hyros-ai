import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { PinoLogger } from '@mastra/loggers';
import { supportAgent } from "./agents/support-agent";

/**
 * The central Mastra instance for the Hyros AI gateway.
 *
 * Registered here are all Mastra agents (and, in the future, workflows, tools,
 * memory, etc.). This instance is consumed in-process by the Mastra Hono server
 * (`./server.ts`), whose `.fetch` handler Elysia mounts at `/mastra` — exposing
 * the full agent REST surface (`/mastra/api/agents`,
 * `/mastra/api/agents/:id/generate`, …).
 *
 * Storage: currently LibSQL (`file:./mastra.db`) for the POC. This moves to
 * `@mastra/pg` on the same Postgres as Drizzle once the DB is stood up — see
 * agent-os-architecture.md §4 (deferred: Postgres hosting is local-for-now).
 */
export const mastra = new Mastra({
    workflows: {},
    agents: { supportAgent },
    scorers: {},
    storage: new LibSQLStore({
        id: "mastra-storage",
        url: "file:./mastra.db",
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
