import { eq, isNull } from "drizzle-orm";
import {
    index,
    integer,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

/**
 * Hyros AI database schema — the users/organizations core only (§2, §4 of
 * agent-os-architecture.md).
 *
 * Drizzle owns the public/app schema. Supabase owns `auth.*` (auth + SSO), so we
 * do NOT model `auth.users` here — only an app-level profile row whose `id` equals
 * the Supabase auth user id (uuid). The cross-schema FK to `auth.users` is
 * intentionally omitted so local dev works against a bare Postgres (the Supabase
 * `auth` schema may not exist locally); it can be added later on Supabase cloud PG.
 */

// ── users ───────────────────────────────────────────────────────────────────
// App-level profile, keyed by the Supabase auth user id (uuid). `email`/`name`
// are cached from Supabase for app-side queries; `avatarUrl` is optional.
export const users = pgTable("users", {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

// ── organizations (the tenants / "orgs") ────────────────────────────────────
// The multi-tenant boundary (cf. Clerk `Organization`, WorkOS `Organization`).
// `individual` orgs are auto-provisioned at signup; `team` orgs are multi-member.
export const organizationType = pgEnum("organization_type", [
    "individual",
    "team",
]);

export const organizations = pgTable(
    "organizations",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull(),
        slug: text("slug"),
        type: organizationType("type").notNull().default("individual"),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => ({
        // Nullable on purpose: `individual` orgs may skip a slug. PG unique indexes
        // allow multiple NULLs, so individual orgs never collide here.
        slugIdx: uniqueIndex("organizations_slug_idx").on(t.slug),
        // Exactly one personal tenant per user. Auto-provisioning runs on the
        // request path, so two concurrent first-agent creations would otherwise
        // race into two individual orgs — and an org owns a sandbox, a volume and
        // a network, which nobody wants a duplicate of.
        individualOwnerIdx: uniqueIndex("organizations_individual_owner_uidx")
            .on(t.createdBy)
            .where(eq(t.type, "individual")),
    }),
);

// ── organization_memberships (users ↔ organizations, many-to-many) ───────────
// The standard multi-tenant join (cf. Clerk `OrganizationMembership`,
// WorkOS `organization_members`). The arch doc mandates one user → many orgs.
//
// `role` is a plain `text` stub — RBAC is deferred per arch §11. Text (rather
// than a pgEnum) avoids enum-migration churn when roles are finalized later.
export const organizationMemberships = pgTable(
    "organization_memberships",
    {
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: text("role").notNull().default("member"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => ({
        // One membership per (organization, user).
        pk: primaryKey({ columns: [t.organizationId, t.userId] }),
    }),
);

// ── agents ───────────────────────────────────────────────────────────────────
// User-owned AI agents, created via the chat-based "+" flow. The creation chat
// fills attributes progressively, so `description`/`avatarUrl` stay nullable
// until the agent sets them; `name` is required at insert (the flow inserts
// with a placeholder like "New agent" and the agent renames itself).
//
// `avatarUrl` is a locally rendered DiceBear SVG data URI. The gateway renders
// the selected style + config with @dicebear/core during profile updates.
// Renderers fall back to the agent's initials until the profile is complete.
export const agents = pgTable(
    "agents",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ownerId: uuid("owner_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        /**
         * Tenant this agent belongs to. It decides which sandbox container the
         * agent runs in: one container, volume and network per organization,
         * shared by every agent in it (sandbox-service/README.md).
         */
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        /** Model-visible routing address; unique within an owner's directory. */
        slug: text("slug"),
        /**
         * OS uid this agent execs as inside its organization's shared container,
         * from the pool baked into the sandbox image (10000–10063).
         *
         * Assigned once and never reused, archived agents included: the uid is
         * what keeps one agent out of another's `0700` directory, and those
         * directories outlive the agent in the volume.
         */
        sandboxUid: integer("sandbox_uid"),
        description: text("description"),
        avatarUrl: text("avatar_url"),
        /** Soft-delete marker. Archived agents retain their history/profile. */
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => ({
        // Chat list = "my agents by recency" → every query filters on owner.
        ownerIdx: index("agents_owner_id_idx").on(t.ownerId),
        ownerArchivedIdx: index("agents_owner_archived_idx").on(
            t.ownerId,
            t.archivedAt,
        ),
        // Addresses are unique among an owner's ACTIVE agents only: archiving an
        // agent releases its address so the same display name can be used again.
        ownerSlugIdx: uniqueIndex("agents_owner_slug_uidx")
            .on(t.ownerId, t.slug)
            .where(isNull(t.archivedAt)),
        // Every sandbox lookup is "this organization's agents".
        organizationIdx: index("agents_organization_id_idx").on(t.organizationId),
        // Deliberately NOT filtered on archivedAt, unlike the address index above:
        // an archived agent's directory still sits in the volume, so handing its
        // uid to a new agent would make those leftovers readable.
        organizationSandboxUidIdx: uniqueIndex("agents_organization_sandbox_uid_uidx").on(
            t.organizationId,
            t.sandboxUid,
        ),
    }),
);
