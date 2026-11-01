ALTER TABLE "guilds" ALTER COLUMN "claim_window_seconds" SET DEFAULT 120;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "parent_id" bigint;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "edition" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_id_entities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_parent" ON "entities" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_edition" ON "entities" USING btree ("edition") WHERE "entities"."edition" IS NOT NULL;
--> statement-breakpoint
-- O drizzle-kit 0.24 nao gera CHECK (ver 0002): edicao restrita aos tres valores conhecidos.
ALTER TABLE "entities" ADD CONSTRAINT "entities_edition_ck" CHECK ("edition" IS NULL OR "edition" IN ('BASIC', 'EPIC', 'MYTHIC'));
