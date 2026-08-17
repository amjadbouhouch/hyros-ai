/**
 * Entry point.
 *
 * Shutdown deliberately leaves containers running. They outlive this process by
 * design — an agent mid-task must survive a deploy of the service in front of
 * it, and the volume holds the state either way. Boot adopts whatever is still
 * there, so nothing leaks.
 */

import { app } from "./routes.js";
import { adoptExistingSandboxes, startReaper, stopReaper } from "./store.js";

const PORT = Number(process.env.SANDBOX_SERVICE_PORT) || 3100;

const shutdown = () => {
    console.log("[sandbox-service] shutting down — containers left running");
    stopReaper();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await adoptExistingSandboxes();
startReaper();

app.listen(PORT, () => {
    console.log(`[sandbox-service] listening on http://localhost:${PORT}`);
    if (!process.env.SANDBOX_SERVICE_TOKEN) {
        console.warn(
            "[sandbox-service] SANDBOX_SERVICE_TOKEN is unset — auth is DISABLED (local dev only)",
        );
    }
});
