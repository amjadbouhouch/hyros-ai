ALTER TABLE "agents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agents_owner_archived_idx" ON "agents" USING btree ("owner_id","archived_at");