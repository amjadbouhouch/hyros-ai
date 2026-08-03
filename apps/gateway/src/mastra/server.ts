/**
 * Mastra agent runtime, mounted in-process under Elysia.
 *
 * Mastra ships server adapters for Hono, Express, Fastify, Koa, and NestJS —
 * **there is no Elysia adapter** (verified; `@mastra/elysia` does not exist on
 * npm). The mount seam documented in `agent-os-architecture.md` §3 is therefore:
 *
 *   Elysia (control plane)
 *     └─ .mount("/mastra", mastraHonoApp.fetch)   ← Mastra Hono runtime
 *
 * Elysia's `.mount(path, handle)` rewrites the request URL to strip the prefix
 * before handing a web-standard `Request` to `handle`. A Hono app exposes exactly
 * such a handler via `.fetch`, so the whole Mastra REST surface (agents, tools,
 * workflows, OpenAPI) becomes available at `/mastra/*` — one Bun process, one
 * port, zero network hop.
 *
 * This module builds (and `init()`s) that Hono app and exports its `.fetch`
 * handler so `apps/gateway/src/index.ts` can mount it. Routes are registered
 * during `await mastraServer.init()`, so the handler is only ready after that
 * top-level await resolves; importing this module (from the value import in
 * `index.ts`) awaits it before `new Elysia()` runs, guaranteeing the mount is
 * live by the time Elysia starts listening.
 */
import { Hono } from "hono";
import { MastraServer } from "@mastra/hono";
import type { HonoBindings, HonoVariables } from "@mastra/hono";

import { mastra } from "./index.js";

/** A Hono app with all Mastra agent-runtime routes registered on it. */
const mastraHonoApp = new Hono<{
    Bindings: HonoBindings;
    Variables: HonoVariables;
}>();

const mastraServer = new MastraServer({ app: mastraHonoApp, mastra });

// Register every Mastra route (agents, tools, workflows, OpenAPI, …) onto the
// Hono app. Top-level await: this resolves before the module finishes loading,
// so `mastraFetch` below is ready to serve by the time Elysia mounts it.
await mastraServer.init();

/**
 * Web-standard fetch handler for the Mastra agent runtime.
 *
 * Pass this to Elysia's `.mount("/mastra", mastraFetch)`. Elysia strips the
 * `/mastra` prefix, so a client hitting `/mastra/api/agents` is routed by Hono
 * to Mastra's `/api/agents` endpoint.
 */
export const mastraFetch = mastraHonoApp.fetch;

export { mastraHonoApp, mastraServer };
