ALTER TABLE "agents" ADD COLUMN "slug" text;--> statement-breakpoint
WITH normalized AS (
    SELECT
        "id",
        "owner_id",
        trim(both '-' from regexp_replace(
            lower(regexp_replace(
                normalize(trim("name"), NFD),
                '[' || chr(768) || '-' || chr(879) || ']',
                '',
                'g'
            )),
            '[^a-z0-9]+',
            '-',
            'g'
        )) AS "slug"
    FROM "agents"
    WHERE "description" IS NOT NULL
), routable AS (
    -- Existing collisions stay unaddressed (NULL) instead of silently routing
    -- one display name to an arbitrary agent. Renaming either agent later gives
    -- it a validated address through updateProfileTool.
    SELECT "owner_id", "slug"
    FROM normalized
    WHERE "slug" <> ''
    GROUP BY "owner_id", "slug"
    HAVING count(*) = 1
)
UPDATE "agents" AS agent
SET "slug" = normalized."slug"
FROM normalized
JOIN routable USING ("owner_id", "slug")
WHERE agent."id" = normalized."id";--> statement-breakpoint
CREATE UNIQUE INDEX "agents_owner_slug_uidx" ON "agents" USING btree ("owner_id","slug");
