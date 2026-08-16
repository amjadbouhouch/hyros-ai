import { Elysia } from "elysia";

import { createLogger } from "./logger.js";

const log = createLogger("http");

/**
 * While the desktop waits for the OAuth code it polls every 750 ms — a miss
 * (404) per poll would drown the logs, so those go to debug. Everything else
 * (including the poll that DELIVERS the code) stays at info/warn/error.
 */
const POLL_PATH = /^\/auth\/oauth\/poll\//;

/**
 * Request logger — one line per request: method, path, status, duration.
 * Hooks are `as: "global"` so they cover every route of the root app tree
 * (/health, /mastra/*, /auth/session, the OAuth bridge) no matter which
 * sub-plugin defines them.
 */
export const httpLogger = new Elysia({ name: "http-logger" })
    .derive({ as: "global" }, () => ({ requestStart: performance.now() }))
    .onAfterHandle({ as: "global" }, ({ request, set, requestStart }) => {
        const ms = Math.round((performance.now() - requestStart) * 10) / 10;
        const status = typeof set.status === "number" ? set.status : 200;
        const data = {
            method: request.method,
            path: new URL(request.url).pathname,
            status,
            ms,
            traceId:
                request.headers.get("x-hyros-trace-id") ??
                new URL(request.url).searchParams.get("traceId") ??
                undefined,
        };
        if (POLL_PATH.test(data.path) && status === 404) {
            log.debug("request", data); // desktop still waiting for the browser
        } else if (status >= 500) {
            log.error("request", data);
        } else if (status >= 400) {
            log.warn("request", data);
        } else {
            log.info("request", data);
        }
    })
    .onError({ as: "global" }, ({ request, error }) => {
        log.error("unhandled error", {
            method: request.method,
            path: new URL(request.url).pathname,
            error: error instanceof Error ? error.message : String(error),
        });
    });
