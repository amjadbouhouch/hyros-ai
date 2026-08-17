DROP INDEX "agents_owner_slug_uidx";--> statement-breakpoint
-- Backfill every active, onboarded agent that migration 0003 left unaddressed
-- (its display name collided with another agent's). Each one now gets its base
-- address, or the first free "-2", "-3", … variant within its owner's active
-- directory, so no onboarded agent stays unreachable by agent messaging.
DO $$
DECLARE
    unaddressed RECORD;
    base_slug text;
    candidate text;
    attempt int;
BEGIN
    FOR unaddressed IN
        SELECT "id", "owner_id", "name"
        FROM "agents"
        WHERE "slug" IS NULL
          AND "description" IS NOT NULL
          AND "archived_at" IS NULL
        ORDER BY "created_at", "id"
    LOOP
        base_slug := trim(both '-' from regexp_replace(
            lower(regexp_replace(
                normalize(trim(unaddressed."name"), NFD),
                '[' || chr(768) || '-' || chr(879) || ']',
                '',
                'g'
            )),
            '[^a-z0-9]+',
            '-',
            'g'
        ));
        IF base_slug = '' THEN
            base_slug := 'agent';
        END IF;
        candidate := base_slug;
        attempt := 1;
        WHILE EXISTS (
            SELECT 1
            FROM "agents"
            WHERE "owner_id" = unaddressed."owner_id"
              AND "slug" = candidate
              AND "archived_at" IS NULL
        ) LOOP
            attempt := attempt + 1;
            candidate := base_slug || '-' || attempt;
        END LOOP;
        UPDATE "agents" SET "slug" = candidate WHERE "id" = unaddressed."id";
    END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_owner_slug_uidx" ON "agents" USING btree ("owner_id","slug") WHERE "agents"."archived_at" is null;
