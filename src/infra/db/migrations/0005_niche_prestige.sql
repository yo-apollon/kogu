CREATE TABLE IF NOT EXISTS "niches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "niches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"label_pt" text NOT NULL,
	"label_en" text NOT NULL,
	"family" text NOT NULL,
	"profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prestige_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prestige_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_id" bigint NOT NULL,
	"previous" real,
	"next" real NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "niche_id" bigint;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "prestige" real;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "prestige_source" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "prestige_reason" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "tier_floor" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prestige_audit" ADD CONSTRAINT "prestige_audit_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_niches_key" ON "niches" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prestige_audit_entity" ON "prestige_audit" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entities_niche_prestige" ON "entities" USING btree ("niche_id","prestige" DESC NULLS LAST) WHERE "entities"."status" = 'ACTIVE';
--> statement-breakpoint
-- O drizzle-kit 0.24 nao gera CHECK (ver 0002): faixa e origem do prestigio, piso de tier, familia do nicho.
ALTER TABLE "niches" ADD CONSTRAINT "niches_family_ck" CHECK ("family" IN ('fiction', 'people_sport', 'people_music', 'people_creator'));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_prestige_ck" CHECK ("prestige" IS NULL OR ("prestige" >= 0 AND "prestige" <= 100));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_prestige_source_ck" CHECK ("prestige_source" IS NULL OR "prestige_source" IN ('COMPUTED', 'CURATED', 'OVERRIDE'));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_tier_floor_ck" CHECK ("tier_floor" IS NULL OR "tier_floor" IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY'));--> statement-breakpoint
ALTER TABLE "prestige_audit" ADD CONSTRAINT "prestige_audit_source_ck" CHECK ("source" IN ('COMPUTED', 'CURATED', 'OVERRIDE'));--> statement-breakpoint
ALTER TABLE "prestige_audit" ADD CONSTRAINT "prestige_audit_range_ck" CHECK (("previous" IS NULL OR ("previous" >= 0 AND "previous" <= 100)) AND "next" >= 0 AND "next" <= 100);--> statement-breakpoint
-- Nichos iniciais (docs/raridade-por-nicho.md, secoes 3 e 12). Nichos novos entram so com um INSERT aqui ou via SQL.
INSERT INTO "niches" ("key", "label_pt", "label_en", "family") VALUES
  ('anime', 'Anime e mangá', 'Anime and manga', 'fiction'),
  ('manhwa_vn', 'Manhwa e visual novels', 'Manhwa and visual novels', 'fiction'),
  ('game', 'Jogos', 'Games', 'fiction'),
  ('cinema_tv', 'Cinema e TV', 'Film and TV', 'fiction'),
  ('idol', 'Idols', 'Idols', 'people_music'),
  ('music_pop', 'Música pop', 'Pop music', 'people_music'),
  ('music_rock', 'Rock', 'Rock', 'people_music'),
  ('music_hiphop', 'Hip-hop', 'Hip-hop', 'people_music'),
  ('music_other', 'Música: outros gêneros', 'Music: other genres', 'people_music'),
  ('sport_football', 'Futebol', 'Football', 'people_sport'),
  ('sport_basketball', 'Basquete', 'Basketball', 'people_sport'),
  ('sport_mma', 'MMA', 'MMA', 'people_sport'),
  ('creator_fitness', 'Criadores: fitness', 'Creators: fitness', 'people_creator'),
  ('creator_gaming', 'Criadores: games', 'Creators: gaming', 'people_creator'),
  ('creator_music', 'Criadores: música e rap', 'Creators: music and rap', 'people_creator'),
  ('creator_anime_geek', 'Criadores: anime e geek', 'Creators: anime and geek', 'people_creator'),
  ('creator_comedy', 'Criadores: humor', 'Creators: comedy', 'people_creator'),
  ('creator_tech_edu', 'Criadores: tecnologia e educação', 'Creators: tech and education', 'people_creator'),
  ('creator_lifestyle', 'Criadores: vlog e estilo de vida', 'Creators: vlog and lifestyle', 'people_creator'),
  ('creator_podcast_talk', 'Criadores: podcast e bate-papo', 'Creators: podcast and talk', 'people_creator'),
  ('creator_food', 'Criadores: culinária', 'Creators: food', 'people_creator')
ON CONFLICT ("key") DO NOTHING;
