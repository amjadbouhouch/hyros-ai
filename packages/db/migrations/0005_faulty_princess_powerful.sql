-- Agents gain a tenant and a sandbox uid.
--
-- Both columns are added nullable and backfilled before the constraints land:
-- there are already agents in this table, so `ADD COLUMN ... NOT NULL` would fail
-- outright. Existing owners get the personal organization §2 always specified but
-- nothing had created yet.
ALTER TABLE "agents" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sandbox_uid" integer;--> statement-breakpoint

-- One individual organization per user who owns agents. Users with no agents get
-- theirs on demand, the first time they create one.
INSERT INTO "organizations" ("name", "type", "created_by")
SELECT u."name", 'individual', u."id"
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "agents" a WHERE a."owner_id" = u."id")
  AND NOT EXISTS (
      SELECT 1 FROM "organizations" o
      WHERE o."created_by" = u."id" AND o."type" = 'individual'
  );--> statement-breakpoint

-- The creator is a member, and owns it.
INSERT INTO "organization_memberships" ("organization_id", "user_id", "role")
SELECT o."id", o."created_by", 'owner'
FROM "organizations" o
WHERE o."type" = 'individual'
ON CONFLICT DO NOTHING;--> statement-breakpoint

UPDATE "agents" a
SET "organization_id" = o."id"
FROM "organizations" o
WHERE o."created_by" = a."owner_id"
  AND o."type" = 'individual'
  AND a."organization_id" IS NULL;--> statement-breakpoint

-- uids come from the pool baked into the sandbox image (10000 + 64). Oldest agent
-- first, so the assignment is deterministic and repeatable. An organization with
-- more agents than the pool leaves the rest NULL: allocation then fails loudly
-- instead of exec'ing as a uid that has no OS user in the image.
WITH numbered AS (
    SELECT
        a."id",
        10000 + (
            row_number() OVER (
                PARTITION BY a."organization_id" ORDER BY a."created_at", a."id"
            ) - 1
        ) AS "uid"
    FROM "agents" a
    WHERE a."sandbox_uid" IS NULL
)
UPDATE "agents" a
SET "sandbox_uid" = n."uid"
FROM numbered n
WHERE a."id" = n."id" AND n."uid" < 10000 + 64;--> statement-breakpoint

ALTER TABLE "agents" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_organization_id_idx" ON "agents" USING btree ("organization_id");--> statement-breakpoint
-- Not filtered on archived_at: an archived agent's directory still exists in the
-- volume, so its uid must never come back around.
CREATE UNIQUE INDEX "agents_organization_sandbox_uid_uidx" ON "agents" USING btree ("organization_id","sandbox_uid");--> statement-breakpoint
-- The literal is spelled out here on purpose: drizzle-kit generates this
-- predicate as a bind placeholder ($1), which a migration file cannot bind.
CREATE UNIQUE INDEX "organizations_individual_owner_uidx" ON "organizations" USING btree ("created_by") WHERE "organizations"."type" = 'individual';
