DO $$ BEGIN
 CREATE TYPE "public"."card_variant" AS ENUM('STANDARD', 'FOIL', 'HOLO', 'ASTRAL');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."catalog_source" AS ENUM('ANILIST', 'JIKAN', 'IGDB', 'TMDB', 'MANUAL', 'LEGACY');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."entity_status" AS ENUM('ACTIVE', 'PENDING_REVIEW', 'QUARANTINED', 'DISABLED', 'MERGED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."entity_tier" AS ENUM('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."entity_type" AS ENUM('CHARACTER', 'WEAPON', 'COMPANION', 'DOMAIN');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gender" AS ENUM('FEMALE', 'MALE', 'NONBINARY', 'ITEM', 'UNKNOWN');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."media_type" AS ENUM('ANIME_TV', 'ANIME_MOVIE', 'ANIME_OVA', 'ANIME_ONA', 'MANGA', 'GAME', 'MOVIE', 'TV_SHOW', 'OTHER');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."moderation_reason" AS ENUM('NO_IMAGE', 'UNKNOWN_GENDER', 'LEGACY_GENDER', 'ADULT_CONTENT', 'INVALID_NAME', 'LOW_FAVORITES', 'DUPLICATE_SUSPECT', 'REAL_PERSON', 'UNMATCHED_DISABLED_SERIES', 'USER_REPORT', 'TAKEDOWN', 'OTHER');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."sync_status" AS ENUM('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."universe" AS ENUM('ANIME', 'GAME', 'CINEMA');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"prefix" text DEFAULT '$' NOT NULL,
	"language" text DEFAULT 'pt-BR' NOT NULL,
	"gamemode" integer DEFAULT 1 NOT NULL,
	"base_rolls" integer DEFAULT 10 NOT NULL,
	"roll_interval_min" integer DEFAULT 60 NOT NULL,
	"reset_offset_min" integer DEFAULT 0 NOT NULL,
	"claim_cooldown_minutes" integer DEFAULT 180 NOT NULL,
	"pacts_per_window" integer DEFAULT 1 NOT NULL,
	"claim_window_seconds" integer DEFAULT 45 NOT NULL,
	"snipe_protection_level" integer DEFAULT 0 NOT NULL,
	"snipe_protection_seconds" integer DEFAULT 8 NOT NULL,
	"aether_snipe_protection_level" integer DEFAULT 0 NOT NULL,
	"aether_snipe_protection_seconds" integer DEFAULT 8 NOT NULL,
	"pact_limit" integer DEFAULT 8100 NOT NULL,
	"server_aether_scrap" integer DEFAULT 0 NOT NULL,
	"release_boost_enabled" boolean DEFAULT true NOT NULL,
	"allow_adult" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"preferred_language" text DEFAULT 'pt-BR' NOT NULL,
	"roll_resets" integer DEFAULT 0 NOT NULL,
	"is_vip" boolean DEFAULT false NOT NULL,
	"vip_tier" integer DEFAULT 0 NOT NULL,
	"daily_imports_count" integer DEFAULT 0 NOT NULL,
	"last_import_reset" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guild_members" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"aether_balance" bigint DEFAULT 0 NOT NULL,
	"astral_shards" integer DEFAULT 0 NOT NULL,
	"rolls_used" integer DEFAULT 0 NOT NULL,
	"rolls_window" integer DEFAULT -1 NOT NULL,
	"stacked_rolls" integer DEFAULT 0 NOT NULL,
	"pacts_used" integer DEFAULT 0 NOT NULL,
	"pact_window" integer DEFAULT -1 NOT NULL,
	"embed_color" text DEFAULT '#5865F2',
	"relic_bronze" integer DEFAULT 0 NOT NULL,
	"relic_silver" integer DEFAULT 0 NOT NULL,
	"relic_gold" integer DEFAULT 0 NOT NULL,
	"relic_sapphire" integer DEFAULT 0 NOT NULL,
	"relic_ruby" integer DEFAULT 0 NOT NULL,
	"relic_emerald" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_members_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"legacy_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_native" text,
	"name_normalized" text NOT NULL,
	"universe" "universe" NOT NULL,
	"type" "entity_type" DEFAULT 'CHARACTER' NOT NULL,
	"gender" "gender" DEFAULT 'UNKNOWN' NOT NULL,
	"franchise_id" bigint,
	"description" text,
	"status" "entity_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"is_adult" boolean DEFAULT false NOT NULL,
	"source_favorites" integer DEFAULT 0 NOT NULL,
	"popularity_score" real DEFAULT 0 NOT NULL,
	"popularity_rank" integer,
	"like_rank" integer,
	"claim_rank" integer,
	"tier" "entity_tier" DEFAULT 'COMMON' NOT NULL,
	"base_aether" integer DEFAULT 100 NOT NULL,
	"roll_weight" real DEFAULT 1 NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"claims_count" integer DEFAULT 0 NOT NULL,
	"base_atk" integer DEFAULT 50 NOT NULL,
	"base_def" integer DEFAULT 50 NOT NULL,
	"base_spd" integer DEFAULT 50 NOT NULL,
	"base_hp" integer DEFAULT 100 NOT NULL,
	"stats_seed" integer DEFAULT floor(random() * 2147483647)::int NOT NULL,
	"merged_into_id" bigint,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_external_ids" (
	"source" "catalog_source" NOT NULL,
	"external_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_external_ids_pk" PRIMARY KEY("source","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_images" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entity_images_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"url" text NOT NULL,
	"source" "catalog_source" DEFAULT 'MANUAL' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"content_hash" text,
	"width" integer,
	"height" integer,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_series" (
	"entity_id" bigint NOT NULL,
	"series_id" bigint NOT NULL,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_series_pk" PRIMARY KEY("entity_id","series_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "franchises" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "franchises_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "release_windows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "release_windows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"series_id" bigint NOT NULL,
	"source" "catalog_source" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"boost" real DEFAULT 2 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "series" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"franchise_id" bigint,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"title_native" text,
	"media_type" "media_type" DEFAULT 'OTHER' NOT NULL,
	"universe" "universe" NOT NULL,
	"is_adult" boolean DEFAULT false NOT NULL,
	"released_at" date,
	"cover_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "series_external_ids" (
	"source" "catalog_source" NOT NULL,
	"external_id" text NOT NULL,
	"series_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_external_ids_pk" PRIMARY KEY("source","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disabled_series" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "disabled_series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_server_wide" boolean DEFAULT false NOT NULL,
	"series_id" bigint,
	"franchise_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_likes" (
	"user_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_likes_pk" PRIMARY KEY("user_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"variant" "card_variant" DEFAULT 'STANDARD' NOT NULL,
	"awakening_keys" integer DEFAULT 0 NOT NULL,
	"is_soulmate" boolean DEFAULT false NOT NULL,
	"custom_image" text,
	"alias" text,
	"alias2" text,
	"note" text,
	"embed_color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"aether_at_bind" integer DEFAULT 0 NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wishes" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"is_starwish" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishes_pk" PRIMARY KEY("guild_id","user_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roll_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roll_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"rolled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roll_offers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roll_offers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"owner_user_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"variant" "card_variant" DEFAULT 'STANDARD' NOT NULL,
	"aether_value" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"protected_until" timestamp with time zone,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"pact_id" bigint,
	"orb_aether" integer,
	"orb_claimed_by" text,
	"orb_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_sources" (
	"source" "catalog_source" NOT NULL,
	"job" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_sources_pk" PRIMARY KEY("source","job")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_revisions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entity_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"source" "catalog_source" NOT NULL,
	"changed_by" text,
	"reason" text,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_run_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" "catalog_source" NOT NULL,
	"job" text NOT NULL,
	"status" "sync_status" DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"items_quarantined" integer DEFAULT 0 NOT NULL,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_moderators" (
	"user_id" text PRIMARY KEY NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_suggestions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "character_suggestions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"character_name" text NOT NULL,
	"status" "review_status" DEFAULT 'PENDING' NOT NULL,
	"anilist_id" integer,
	"resolved_entity_id" bigint,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moderation_queue" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "moderation_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint,
	"other_entity_id" bigint,
	"reason" "moderation_reason" NOT NULL,
	"status" "review_status" DEFAULT 'PENDING' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_id_entities_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_external_ids" ADD CONSTRAINT "entity_external_ids_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_images" ADD CONSTRAINT "entity_images_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_series" ADD CONSTRAINT "entity_series_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_series" ADD CONSTRAINT "entity_series_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_windows" ADD CONSTRAINT "release_windows_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "series" ADD CONSTRAINT "series_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "series_external_ids" ADD CONSTRAINT "series_external_ids_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disabled_series" ADD CONSTRAINT "disabled_series_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disabled_series" ADD CONSTRAINT "disabled_series_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disabled_series" ADD CONSTRAINT "disabled_series_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disabled_series" ADD CONSTRAINT "disabled_series_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_likes" ADD CONSTRAINT "entity_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_likes" ADD CONSTRAINT "entity_likes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pacts" ADD CONSTRAINT "pacts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pacts" ADD CONSTRAINT "pacts_member_fk" FOREIGN KEY ("guild_id","user_id") REFERENCES "public"."guild_members"("guild_id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wishes" ADD CONSTRAINT "wishes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wishes" ADD CONSTRAINT "wishes_member_fk" FOREIGN KEY ("guild_id","user_id") REFERENCES "public"."guild_members"("guild_id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roll_log" ADD CONSTRAINT "roll_log_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roll_log" ADD CONSTRAINT "roll_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roll_log" ADD CONSTRAINT "roll_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roll_offers" ADD CONSTRAINT "roll_offers_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roll_offers" ADD CONSTRAINT "roll_offers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roll_offers" ADD CONSTRAINT "roll_offers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roll_offers" ADD CONSTRAINT "roll_offers_pact_id_pacts_id_fk" FOREIGN KEY ("pact_id") REFERENCES "public"."pacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_suggestions" ADD CONSTRAINT "character_suggestions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_suggestions" ADD CONSTRAINT "character_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_suggestions" ADD CONSTRAINT "character_suggestions_resolved_entity_id_entities_id_fk" FOREIGN KEY ("resolved_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "moderation_queue" ADD CONSTRAINT "moderation_queue_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "moderation_queue" ADD CONSTRAINT "moderation_queue_other_entity_id_entities_id_fk" FOREIGN KEY ("other_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_guild_members_user" ON "guild_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_entities_slug" ON "entities" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_entities_legacy_id" ON "entities" USING btree ("legacy_id") WHERE "entities"."legacy_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_franchise" ON "entities" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_status" ON "entities" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_name_normalized" ON "entities" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_active_pool" ON "entities" USING btree ("universe","gender","type") WHERE "entities"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_active_score" ON "entities" USING btree ("popularity_score" DESC NULLS LAST) WHERE "entities"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_active_like_rank" ON "entities" USING btree ("like_rank") WHERE "entities"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_external_entity" ON "entity_external_ids" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_entity_images_entity_url" ON "entity_images" USING btree ("entity_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_entity_images_primary" ON "entity_images" USING btree ("entity_id") WHERE "entity_images"."is_primary";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_images_verify" ON "entity_images" USING btree ("last_verified_at") WHERE "entity_images"."is_primary";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_series_series" ON "entity_series" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_entity_series_primary" ON "entity_series" USING btree ("entity_id") WHERE "entity_series"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_franchises_slug" ON "franchises" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_release_windows_open_series" ON "release_windows" USING btree ("series_id") WHERE "release_windows"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_release_windows_open_ends" ON "release_windows" USING btree ("ends_at") WHERE "release_windows"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_series_slug" ON "series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_series_franchise" ON "series" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_series_universe" ON "series" USING btree ("universe");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_series_external_series" ON "series_external_ids" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_disabled_series_series" ON "disabled_series" USING btree ("guild_id","user_id","is_server_wide","series_id") WHERE "disabled_series"."series_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_disabled_series_franchise" ON "disabled_series" USING btree ("guild_id","user_id","is_server_wide","franchise_id") WHERE "disabled_series"."franchise_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_disabled_series_guild" ON "disabled_series" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_disabled_series_series" ON "disabled_series" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_disabled_series_franchise" ON "disabled_series" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_likes_entity" ON "entity_likes" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pacts_guild_entity" ON "pacts" USING btree ("guild_id","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pacts_guild_user" ON "pacts" USING btree ("guild_id","user_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pacts_entity" ON "pacts" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wishes_guild_entity" ON "wishes" USING btree ("guild_id","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_log_guild_recent" ON "roll_log" USING btree ("guild_id","rolled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_log_rolled_at" ON "roll_log" USING btree ("rolled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_roll_offers_message" ON "roll_offers" USING btree ("channel_id","message_id") WHERE "roll_offers"."message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_offers_open_expires" ON "roll_offers" USING btree ("expires_at") WHERE "roll_offers"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_offers_guild" ON "roll_offers" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roll_offers_entity" ON "roll_offers" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_revisions_entity" ON "entity_revisions" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_runs_job" ON "sync_runs" USING btree ("source","job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_suggestions_guild" ON "character_suggestions" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_moderation_pending" ON "moderation_queue" USING btree ("reason","created_at") WHERE "moderation_queue"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_moderation_entity" ON "moderation_queue" USING btree ("entity_id");