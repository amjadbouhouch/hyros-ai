import { app } from "./index.js";

/**
 * Bin entrypoint for the gateway.
 *
 * - `bunx @hyros-ai/gateway` → runs this file under Bun.
 * - `bun build src/cli.ts --compile --outfile hyros-ai-gateway` → produces a
 *   standalone binary with the Bun runtime embedded (no Bun install required
 *   by end users). See architecture.md §8 for the distribution strategy.
 */
const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
    console.log(`🚀 Hyros AI gateway running at http://${app.server?.hostname}:${app.server?.port}`);
});