import { app } from "./index.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("server");

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
    log.info("🚀 gateway listening", {
        url: `http://${app.server?.hostname}:${app.server?.port}`,
        logLevel: process.env.LOG_LEVEL ?? "info",
    });
    log.info(
        "routes: GET /health · /mastra/* · POST /chat (SSE) · PATCH /agents/:agentId/archive · GET /auth/session · " +
            "GET /auth/oauth/callback/:pollId · GET /auth/oauth/poll/:pollId",
    );
    log.info("hint: LOG_LEVEL=debug to see every desktop OAuth poll");
});
