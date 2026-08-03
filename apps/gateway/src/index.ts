import { Elysia, t } from "elysia";
import type { HealthResponse } from "@hyros-ai/types";

import { mastraFetch } from "./mastra/server.js";

/**
 * Elysia app instance — the single source of truth for the API contract.
 *
 * `index.ts` holds ONLY the app definition (no `.listen()`), so that
 * `import type { App } from '@hyros-ai/gateway'` elsewhere (web, desktop,
 * mobile, CLI) never pulls server/runtime code into those bundles — the
 * `import type` is erased by the bundler, so the Mastra import below never
 * executes in client bundles. The actual server bootstrap lives in
 * `server.ts`; the bin entrypoint lives in `cli.ts`.
 *
 * Architecture (see agent-os-architecture.md §3):
 *
 *   Elysia (control plane: auth, tenancy, integrations, billing)
 *     └─ .mount("/mastra", mastraHonoApp.fetch)   ← Mastra agent runtime
 *
 * Mastra has no Elysia adapter (verified), so we mount its Hono server in
 * process. This gives one Bun process, one port, zero network hop, with Elysia
 * as the auth/tenancy gate wrapping all routes including Mastra's.
 */

export const app = new Elysia()
    .get(
        "/health",
        (): HealthResponse => ({
            status: "ok",
            version: "0.0.0",
            timestamp: new Date().toISOString(),
        }),
        {
            response: t.Object({
                status: t.Union([t.Literal("ok"), t.Literal("degraded")]),
                version: t.String(),
                timestamp: t.String(),
            }),
        },
    )
    // ── Mastra agent runtime, mounted in process ──────────────────────────
    //
    // `mastraFetch` is the Hono app's `.fetch` handler, with all Mastra
    // routes (agents, tools, workflows, OpenAPI) already registered during
    // `await mastraServer.init()` in `./mastra/server.ts`. Elysia rewrites the
    // request URL to strip the `/mastra` prefix, so e.g. `GET /mastra/api/agents`
    // is routed by Hono to Mastra's `/api/agents` endpoint.
    .mount("/mastra", mastraFetch);

/** The Elysia app type — imported (type-only) by @hyros-ai/api-client. */
export type App = typeof app;

