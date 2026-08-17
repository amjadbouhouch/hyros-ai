/**
 * HTTP surface. Elysia, matching the gateway — one framework in the repo, and
 * schema validation instead of hand-rolled field checks.
 *
 * ```
 * GET    /health
 * POST   /sandboxes                                  create or adopt, 201 / 200
 * GET    /sandboxes/:organizationId                   registry lookup only
 * POST   /sandboxes/:organizationId/agents/:agentId   give an agent its directory
 * POST   /sandboxes/:organizationId/exec              run a command as an agent
 * POST   /sandboxes/:organizationId/write-file        write via stdin (no ARG_MAX)
 * POST   /sandboxes/:organizationId/read-file         read as base64
 * POST   /sandboxes/:organizationId/list-tree         list subtrees in one exec
 * DELETE /sandboxes/:organizationId                   remove container; ?purgeVolume=1 wipes data
 * ```
 *
 * Every route but the two lookups is self-healing: it starts or adopts the
 * organization's container if it is not up. A container is a cache in front of
 * the volume, so rebuilding one loses nothing and the client never has to
 * orchestrate a reconnect.
 *
 * `agentId` is what picks the uid, the working directory, and the jail the path
 * is checked against — a path resolving outside that agent's directory is
 * rejected here, `..` included.
 */

import { Elysia, t } from "elysia";

import { SandboxError } from "./errors.js";
import { isValidOrganizationId } from "./layout.js";
import { SandboxBusyError, withSandboxSlot } from "./limits.js";
import { destroySandbox, ensureSandbox, getSandbox, touchSandbox } from "./store.js";
import { TREE_MAX_DEPTH } from "./tree.js";

const SERVICE_TOKEN = process.env.SANDBOX_SERVICE_TOKEN;

/**
 * Ceiling on a client-supplied per-command timeout. The client picks the budget
 * for its own command; this stops one from parking a concurrency slot forever.
 */
const MAX_EXEC_TIMEOUT_MS = Number(process.env.SANDBOX_REQUEST_TIMEOUT_MS) || 180_000;

/** Which HTTP status each failure code deserves. */
const STATUS_BY_CODE: Record<string, number> = {
    DOCKER_UNAVAILABLE: 503,
    DOCKER_NOT_FOUND: 503,
    DOCKER_TIMEOUT: 504,
    AGENT_NOT_PROVISIONED: 409,
    INVALID_AGENT_ID: 400,
    INVALID_ORGANIZATION_ID: 400,
    UID_OUT_OF_POOL: 400,
    PATH_OUTSIDE_WORKSPACE: 400,
    SANDBOX_BUSY: 429,
};

const agentBody = t.Object({ agentId: t.String({ minLength: 1 }) });

export const app = new Elysia()
    /**
     * Auth runs in `onRequest`, the earliest hook there is, because Elysia
     * validates the body *before* `onBeforeHandle`: an unauthenticated caller
     * with a malformed body would otherwise get a 422 describing the schema
     * instead of a 401. Nothing about this service should answer a stranger.
     */
    .onRequest(({ request }) => {
        if (!SERVICE_TOKEN) return;
        if (!new URL(request.url).pathname.startsWith("/sandboxes")) return;
        if (request.headers.get("authorization") === `Bearer ${SERVICE_TOKEN}`) return;
        return new Response(JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }), {
            status: 401,
            headers: { "content-type": "application/json" },
        });
    })
    .onError(({ error, set }) => {
        if (error instanceof SandboxBusyError) {
            set.status = 429;
            return { error: error.message, code: error.code };
        }
        if (error instanceof SandboxError) {
            set.status = STATUS_BY_CODE[error.code] ?? 500;
            return { error: error.message, code: error.code };
        }
        // Elysia's own validation and not-found errors keep their status.
        const message = error instanceof Error ? error.message : String(error);
        if (!set.status || set.status === 200) set.status = 500;
        return { error: message, code: "UNKNOWN" };
    })

    .get("/health", () => ({ status: "ok", service: "sandbox-service" }))

    .group("/sandboxes", (sandboxes) =>
        sandboxes
            // ─── Create or adopt ─────────────────────────────────────────────
            .post(
                "/",
                async ({ body, set }) => {
                    requireOrganizationId(body.organizationId);
                    const { sandbox, created } = await ensureSandbox({
                        organizationId: body.organizationId,
                        image: body.image,
                        network: body.network,
                        readOnly: body.readOnly,
                        env: body.env,
                    });

                    // The whole roster in one call: the caller knows every agent
                    // that shares this container, and provisioning is idempotent.
                    for (const agent of body.agents ?? []) {
                        await withSandboxSlot(sandbox.id, () => sandbox.ensureAgent(agent));
                    }

                    set.status = created ? 201 : 200;
                    return sandbox.getInfo();
                },
                {
                    body: t.Object({
                        organizationId: t.String({ minLength: 1 }),
                        image: t.Optional(t.String({ minLength: 1 })),
                        network: t.Optional(t.String({ minLength: 1 })),
                        readOnly: t.Optional(t.Boolean()),
                        env: t.Optional(t.Record(t.String(), t.String())),
                        agents: t.Optional(
                            t.Array(
                                t.Object({
                                    agentId: t.String({ minLength: 1 }),
                                    uid: t.Integer(),
                                }),
                            ),
                        ),
                    }),
                },
            )

            // ─── Lookup ──────────────────────────────────────────────────────
            .get(
                "/:organizationId",
                ({ params, set }) => {
                    requireOrganizationId(params.organizationId);
                    const sandbox = getSandbox(params.organizationId);
                    if (!sandbox) {
                        set.status = 404;
                        return { error: "Sandbox not found", code: "SANDBOX_NOT_FOUND" };
                    }
                    return sandbox.getInfo();
                },
                { params: t.Object({ organizationId: t.String({ minLength: 1 }) }) },
            )

            // ─── Provision one agent ─────────────────────────────────────────
            .post(
                "/:organizationId/agents/:agentId",
                async ({ params, body }) => {
                    const sandbox = await resolve(params.organizationId);
                    const agent = { agentId: params.agentId, uid: body.uid };
                    await withSandboxSlot(sandbox.id, () => sandbox.ensureAgent(agent));
                    return { success: true, ...agent };
                },
                {
                    params: t.Object({
                        organizationId: t.String({ minLength: 1 }),
                        agentId: t.String({ minLength: 1 }),
                    }),
                    body: t.Object({ uid: t.Integer() }),
                },
            )

            // ─── Run a command ───────────────────────────────────────────────
            .post(
                "/:organizationId/exec",
                async ({ params, body }) => {
                    const sandbox = await resolve(params.organizationId);
                    const timeoutMs = Math.min(
                        body.options?.timeoutMs ?? MAX_EXEC_TIMEOUT_MS,
                        MAX_EXEC_TIMEOUT_MS,
                    );
                    return withSandboxSlot(sandbox.id, () =>
                        sandbox.executeCommand(body.command, body.args, {
                            agentId: body.agentId,
                            timeoutMs,
                            env: body.options?.env,
                            cwd: body.options?.cwd,
                        }),
                    );
                },
                {
                    params: t.Object({ organizationId: t.String({ minLength: 1 }) }),
                    body: t.Composite([
                        agentBody,
                        t.Object({
                            command: t.String({ minLength: 1 }),
                            args: t.Optional(t.Array(t.String())),
                            options: t.Optional(
                                t.Object({
                                    timeoutMs: t.Optional(t.Integer({ minimum: 1 })),
                                    env: t.Optional(t.Record(t.String(), t.String())),
                                    cwd: t.Optional(t.String({ minLength: 1 })),
                                }),
                            ),
                        }),
                    ]),
                },
            )

            // ─── Write a file ────────────────────────────────────────────────
            .post(
                "/:organizationId/write-file",
                async ({ params, body, set }) => {
                    const sandbox = await resolve(params.organizationId);
                    const result = await withSandboxSlot(sandbox.id, () =>
                        sandbox.writeFile(body.agentId, body.path, body.content, body.encoding),
                    );
                    if (!result.success) set.status = 500;
                    return result;
                },
                {
                    params: t.Object({ organizationId: t.String({ minLength: 1 }) }),
                    body: t.Composite([
                        agentBody,
                        t.Object({
                            path: t.String({ minLength: 1 }),
                            content: t.String(),
                            encoding: t.Optional(
                                t.Union([t.Literal("utf-8"), t.Literal("base64")]),
                            ),
                        }),
                    ]),
                },
            )

            // ─── Read a file ─────────────────────────────────────────────────
            .post(
                "/:organizationId/read-file",
                async ({ params, body, set }) => {
                    const sandbox = await resolve(params.organizationId);
                    const result = await withSandboxSlot(sandbox.id, () =>
                        sandbox.readFile(body.agentId, body.path),
                    );
                    if (!result.success) set.status = 500;
                    return result;
                },
                {
                    params: t.Object({ organizationId: t.String({ minLength: 1 }) }),
                    body: t.Composite([agentBody, t.Object({ path: t.String({ minLength: 1 }) })]),
                },
            )

            // ─── List a subtree ──────────────────────────────────────────────
            .post(
                "/:organizationId/list-tree",
                async ({ params, body }) => {
                    const sandbox = await resolve(params.organizationId);
                    return withSandboxSlot(sandbox.id, () =>
                        sandbox.listTree(body.agentId, body.roots, body.maxDepth),
                    );
                },
                {
                    params: t.Object({ organizationId: t.String({ minLength: 1 }) }),
                    body: t.Composite([
                        agentBody,
                        t.Object({
                            roots: t.Array(t.String({ minLength: 1 }), {
                                minItems: 1,
                                maxItems: 16,
                            }),
                            maxDepth: t.Optional(
                                t.Integer({ minimum: 1, maximum: TREE_MAX_DEPTH }),
                            ),
                        }),
                    ]),
                },
            )

            // ─── Destroy ─────────────────────────────────────────────────────
            .delete(
                "/:organizationId",
                async ({ params, query, set }) => {
                    requireOrganizationId(params.organizationId);
                    // The volume holds the tenant's work, so removing it takes an
                    // explicit flag. Without one this is just a warm-cache drop.
                    const purgeVolume = query.purgeVolume === "1" || query.purgeVolume === "true";
                    const destroyed = await destroySandbox(params.organizationId, { purgeVolume });
                    if (!destroyed) {
                        set.status = 404;
                        return { error: "Sandbox not found", code: "SANDBOX_NOT_FOUND" };
                    }
                    return { success: true, purgedVolume: purgeVolume };
                },
                {
                    params: t.Object({ organizationId: t.String({ minLength: 1 }) }),
                    query: t.Object({ purgeVolume: t.Optional(t.String()) }),
                },
            ),
    );

function requireOrganizationId(organizationId: string): void {
    if (!isValidOrganizationId(organizationId)) {
        throw new SandboxError(
            `Invalid organizationId: ${organizationId}`,
            "INVALID_ORGANIZATION_ID",
        );
    }
}

/** Validate the tenant, then start or adopt its container. */
async function resolve(organizationId: string) {
    requireOrganizationId(organizationId);
    const { sandbox } = await ensureSandbox({ organizationId });
    touchSandbox(organizationId);
    return sandbox;
}
