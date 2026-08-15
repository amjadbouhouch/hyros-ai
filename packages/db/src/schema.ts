import {
    index,
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
// `avatarUrl` is a DiceBear URL, Clay style:
//   https://api.dicebear.com/9.x/clay/svg?seed=<seed>
// Store the full URL once the user/agent picks a seed; until then renderers can
// fall back to seed=<agent id> for a deterministic avatar.
export const agents = pgTable(
    "agents",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ownerId: uuid("owner_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        description: text("description"),
        avatarUrl: text("avatar_url"),
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
    }),
);
