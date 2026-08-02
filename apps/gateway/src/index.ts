import { Elysia, t } from "elysia";
import type { HealthResponse, User } from "@hyros-ai/types";

/**
 * Elysia app instance — the single source of truth for the API contract.
 *
 * `index.ts` holds ONLY the app definition (no `.listen()`), so that
 * `import type { App } from '@hyros-ai/gateway'` elsewhere (web, desktop,
 * mobile, CLI) never pulls server/runtime code into those bundles.
 *
 * The actual server bootstrap lives in `server.ts`; the bin entrypoint
 * lives in `cli.ts`.
 */

// --- In-memory demo data (replace with a real data layer later) ---
const users: User[] = [
    { id: "1", email: "ada@hyros.ai", name: "Ada Lovelace", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "2", email: "alan@hyros.ai", name: "Alan Turing", createdAt: "2025-02-01T00:00:00.000Z" },
];

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
    .get(
        "/user/:id",
        ({ params }): User => {
            const user = users.find((u) => u.id === params.id);
            if (!user) {
                throw new Error(`User ${params.id} not found`);
            }
            return user;
        },
        {
            params: t.Object({ id: t.String() }),
            response: t.Object({
                id: t.String(),
                email: t.String(),
                name: t.String(),
                createdAt: t.String(),
            }),
        },
    )
    .get("/users", (): User[] => users, {
        response: t.Array(
            t.Object({
                id: t.String(),
                email: t.String(),
                name: t.String(),
                createdAt: t.String(),
            }),
        ),
    });

/** The Elysia app type — imported (type-only) by @hyros-ai/api-client. */
export type App = typeof app;