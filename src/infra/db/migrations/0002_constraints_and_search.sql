-- O drizzle-kit 0.24 nao gera CHECK, GIN com operator class nem constraint DEFERRABLE.
-- Tudo isto vive so aqui (nao ha check() nos arquivos de schema) para nao duplicar se o kit for atualizado.

-- ===== CHECK =====
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_roll_interval_ck" CHECK ("roll_interval_min" > 0);--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_reset_offset_ck" CHECK ("reset_offset_min" >= 0);--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_base_rolls_ck" CHECK ("base_rolls" >= 0);--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_claim_cooldown_ck" CHECK ("claim_cooldown_minutes" > 0);--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_pacts_per_window_ck" CHECK ("pacts_per_window" >= 0);--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_claim_window_ck" CHECK ("claim_window_seconds" > 0);--> statement-breakpoint

ALTER TABLE "users" ADD CONSTRAINT "users_roll_resets_ck" CHECK ("roll_resets" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_vip_tier_ck" CHECK ("vip_tier" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_daily_imports_ck" CHECK ("daily_imports_count" >= 0);--> statement-breakpoint

ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_aether_ck" CHECK ("aether_balance" >= 0);--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_shards_ck" CHECK ("astral_shards" >= 0);--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_rolls_used_ck" CHECK ("rolls_used" >= 0);--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_stacked_rolls_ck" CHECK ("stacked_rolls" >= 0);--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_pacts_used_ck" CHECK ("pacts_used" >= 0);--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_relics_ck" CHECK (
  "relic_bronze" >= 0 AND "relic_silver" >= 0 AND "relic_gold" >= 0
  AND "relic_sapphire" >= 0 AND "relic_ruby" >= 0 AND "relic_emerald" >= 0
);--> statement-breakpoint

ALTER TABLE "entities" ADD CONSTRAINT "entities_score_ck" CHECK ("popularity_score" >= 0 AND "popularity_score" <= 1);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_roll_weight_ck" CHECK ("roll_weight" >= 0);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_base_aether_ck" CHECK ("base_aether" >= 0);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_counts_ck" CHECK ("likes_count" >= 0 AND "claims_count" >= 0);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_name_len_ck" CHECK (char_length("name") > 0);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_not_self_merged_ck" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");--> statement-breakpoint

ALTER TABLE "entity_images" ADD CONSTRAINT "entity_images_status_ck" CHECK ("status" IN ('ACTIVE', 'BROKEN', 'REMOVED'));--> statement-breakpoint
ALTER TABLE "entity_images" ADD CONSTRAINT "entity_images_primary_active_ck" CHECK (NOT "is_primary" OR "status" = 'ACTIVE');--> statement-breakpoint

ALTER TABLE "release_windows" ADD CONSTRAINT "release_windows_range_ck" CHECK ("ends_at" > "starts_at");--> statement-breakpoint
ALTER TABLE "release_windows" ADD CONSTRAINT "release_windows_boost_ck" CHECK ("boost" >= 1 AND "boost" <= 5);--> statement-breakpoint

ALTER TABLE "pacts" ADD CONSTRAINT "pacts_awakening_keys_ck" CHECK ("awakening_keys" >= 0);--> statement-breakpoint
ALTER TABLE "pacts" ADD CONSTRAINT "pacts_aether_at_bind_ck" CHECK ("aether_at_bind" >= 0);--> statement-breakpoint

-- Exatamente um alvo: serie OU franquia.
ALTER TABLE "disabled_series" ADD CONSTRAINT "disabled_series_target_ck" CHECK (num_nonnulls("series_id", "franchise_id") = 1);--> statement-breakpoint

ALTER TABLE "roll_offers" ADD CONSTRAINT "roll_offers_status_ck" CHECK ("status" IN ('OPEN', 'CLAIMED', 'EXPIRED'));--> statement-breakpoint
ALTER TABLE "roll_offers" ADD CONSTRAINT "roll_offers_claimed_ck" CHECK (("status" = 'CLAIMED') = ("claimed_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "roll_offers" ADD CONSTRAINT "roll_offers_orb_ck" CHECK ("orb_aether" IS NULL OR "orb_aether" > 0);--> statement-breakpoint

ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_counts_ck" CHECK (
  "items_seen" >= 0 AND "items_created" >= 0 AND "items_updated" >= 0 AND "items_quarantined" >= 0
);--> statement-breakpoint

-- ===== popularity_rank unico =====
-- DEFERRABLE INITIALLY DEFERRED: o rerank reatribui todos os ranks num UPDATE so, e a checagem
-- por linha falharia durante a troca. NULL (varios permitidos) = entidade sem rank; o rerank
-- deve zerar o rank de quem deixou de ser ACTIVE na mesma transacao.
ALTER TABLE "entities" ADD CONSTRAINT "uq_entities_popularity_rank" UNIQUE ("popularity_rank") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- ===== Moderacao: um item PENDING por (motivo, entidade, par) =====
CREATE UNIQUE INDEX "uq_moderation_pending" ON "moderation_queue"
  ("reason", "entity_id", COALESCE("other_entity_id", 0))
  WHERE "status" = 'PENDING' AND "entity_id" IS NOT NULL;--> statement-breakpoint

-- ===== Busca por similaridade (autocomplete, dedupe) =====
CREATE INDEX "idx_entities_name_trgm" ON "entities" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_entities_name_normalized_trgm" ON "entities" USING gin ("name_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_series_title_trgm" ON "series" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_franchises_name_trgm" ON "franchises" USING gin ("name" gin_trgm_ops);
