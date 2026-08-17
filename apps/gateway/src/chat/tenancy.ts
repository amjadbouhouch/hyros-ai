/**
 * Tenancy for a new agent: which organization it belongs to, and which OS uid it
 * runs as inside that organization's sandbox container.
 *
 * Both are decided here, at row creation, and never again. An agent's sandbox
 * identity is not derivable from anything else: the organization names the
 * container, the volume and the network, and the uid is what keeps one agent out
 * of another's directory (see sandbox-service/README.md).
 *
 * Every agent row must go through `createAgentRow` for that reason — it is the
 * one place where "an agent always has a tenant and a uid" is true by
 * construction.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { agents, organizationMemberships, organizations } from "@hyros-ai/db";
import { db } from "../lib/db.js";
import { allocateSandboxUid } from "../sandbox/uid-pool.js";
import type { AgentRow } from "./runtime.js";

export interface AgentOwner {
    id: string;
    name: string;
}

/**
 * The user's personal tenant, created on first use.
 *
 * §2 specifies an individual organization auto-provisioned at signup; doing it
 * here instead means the auth path stays untouched and a user who predates this
 * gets one the moment they need it. A partial unique index on
 * `(created_by) WHERE type = 'individual'` is the arbiter, so two concurrent
 * first-agent creations cannot produce two personal tenants — and therefore
 * cannot produce two sandboxes for one person.
 */
export async function ensureIndividualOrganization(owner: AgentOwner): Promise<string> {
    const existing = await findIndividualOrganization(owner.id);
    if (existing) return existing;

    const [created] = await db
        .insert(organizations)
        .values({ name: owner.name, type: "individual", createdBy: owner.id })
        .onConflictDoNothing()
        .returning({ id: organizations.id });

    if (created) {
        await db
            .insert(organizationMemberships)
            .values({ organizationId: created.id, userId: owner.id, role: "owner" })
            .onConflictDoNothing();
        return created.id;
    }

    // Lost the race with a concurrent creation — the index rejected ours, so the
    // winner's row is already there.
    const winner = await findIndividualOrganization(owner.id);
    if (!winner) {
        throw new Error(`could not provision an individual organization for user ${owner.id}`);
    }
    return winner;
}

/**
 * Create an agent row with its tenancy attached.
 *
 * `agentId` is client-generated so a retried create is idempotent (the POST
 * answers 200-empty, so the caller has to know the id up front).
 */
export async function createAgentRow(input: {
    agentId: string;
    owner: AgentOwner;
}): Promise<AgentRow | undefined> {
    const organizationId = await ensureIndividualOrganization(input.owner);

    return db.transaction(async (tx) => {
        // Serialize uid assignment per organization. The unique index would catch
        // a collision anyway, but a lock turns "one of two concurrent creates
        // fails" into "the second one waits and succeeds".
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}::text, 0))`,
        );

        const assigned = await tx
            .select({ uid: agents.sandboxUid })
            .from(agents)
            .where(eq(agents.organizationId, organizationId));

        // Every uid the organization has ever assigned, archived agents included:
        // their directories still exist in the volume, so reusing a uid would make
        // those leftovers readable by whoever comes next.
        const sandboxUid = allocateSandboxUid(
            organizationId,
            assigned
                .map((row) => row.uid)
                .filter((uid): uid is number => typeof uid === "number"),
        );

        const [row] = await tx
            .insert(agents)
            .values({
                id: input.agentId,
                ownerId: input.owner.id,
                organizationId,
                name: "New agent",
                sandboxUid,
            })
            .onConflictDoNothing()
            .returning();
        if (row) return row;

        // The id already exists, so this is a retry. Hand back the existing row;
        // the uid just allocated is simply never used, and nothing was created
        // under it.
        return tx.query.agents.findFirst({
            where: and(
                eq(agents.id, input.agentId),
                eq(agents.ownerId, input.owner.id),
                isNull(agents.archivedAt),
            ),
        });
    });
}

async function findIndividualOrganization(userId: string): Promise<string | undefined> {
    const row = await db.query.organizations.findFirst({
        columns: { id: true },
        where: and(eq(organizations.createdBy, userId), eq(organizations.type, "individual")),
    });
    return row?.id;
}
