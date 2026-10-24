CREATE TABLE IF NOT EXISTS "dashboard_audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dashboard_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guild_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"source" text DEFAULT 'dashboard' NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "bot_present" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "global_name" text;--> statement-breakpoint
ALTER TABLE "guild_members" ADD COLUMN "last_daily_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_audit_log" ADD CONSTRAINT "dashboard_audit_log_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboard_audit_guild_created" ON "dashboard_audit_log" USING btree ("guild_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_log_guild_user_recent" ON "roll_log" USING btree ("guild_id","user_id","rolled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_offers_claimed" ON "roll_offers" USING btree ("guild_id","claimed_by","claimed_at" DESC NULLS LAST) WHERE "roll_offers"."status" = 'CLAIMED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_offers_guild_claimed" ON "roll_offers" USING btree ("guild_id","claimed_at") WHERE "roll_offers"."status" = 'CLAIMED';
--> statement-breakpoint
-- O drizzle-kit 0.24 nao gera CHECK (ver 0002): origem da auditoria restrita a dashboard/bot.
ALTER TABLE "dashboard_audit_log" ADD CONSTRAINT "dashboard_audit_source_ck" CHECK ("source" IN ('dashboard', 'bot'));--> statement-breakpoint
ALTER TABLE "dashboard_rate_limit" ADD CONSTRAINT "dashboard_rate_limit_count_ck" CHECK ("count" >= 0);