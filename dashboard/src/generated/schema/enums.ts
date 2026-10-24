// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import { pgEnum } from "drizzle-orm/pg-core";

// Valores casam com src/config/gacha.ts (tiers/variantes) e com o legado do SQLite.
export const universeEnum = pgEnum("universe", ["ANIME", "GAME", "CINEMA"]);

export const mediaTypeEnum = pgEnum("media_type", [
  "ANIME_TV",
  "ANIME_MOVIE",
  "ANIME_OVA",
  "ANIME_ONA",
  "MANGA",
  "GAME",
  "MOVIE",
  "TV_SHOW",
  "OTHER",
]);

export const entityTypeEnum = pgEnum("entity_type", ["CHARACTER", "WEAPON", "COMPANION", "DOMAIN"]);

// UNKNOWN nunca entra no sorteio: vai para quarentena ate o catalogo confirmar o genero.
export const genderEnum = pgEnum("gender", ["FEMALE", "MALE", "NONBINARY", "ITEM", "UNKNOWN"]);

export const entityStatusEnum = pgEnum("entity_status", [
  "ACTIVE",
  "PENDING_REVIEW",
  "QUARANTINED",
  "DISABLED",
  "MERGED",
]);

export const entityTierEnum = pgEnum("entity_tier", [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "MYTHIC",
]);

export const cardVariantEnum = pgEnum("card_variant", ["STANDARD", "FOIL", "HOLO", "ASTRAL"]);

export const catalogSourceEnum = pgEnum("catalog_source", [
  "ANILIST",
  "JIKAN",
  "IGDB",
  "TMDB",
  "MANUAL",
  "LEGACY",
]);

export const syncStatusEnum = pgEnum("sync_status", ["RUNNING", "SUCCESS", "PARTIAL", "FAILED"]);

export const moderationReasonEnum = pgEnum("moderation_reason", [
  "NO_IMAGE",
  "UNKNOWN_GENDER",
  "LEGACY_GENDER",
  "ADULT_CONTENT",
  "INVALID_NAME",
  "LOW_FAVORITES",
  "DUPLICATE_SUSPECT",
  "REAL_PERSON",
  "UNMATCHED_DISABLED_SERIES",
  "USER_REPORT",
  "TAKEDOWN",
  "OTHER",
]);

export const reviewStatusEnum = pgEnum("review_status", ["PENDING", "APPROVED", "REJECTED"]);
