// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(), // Discord guild ID
  prefix: text("prefix").notNull().default("$"),
  language: text("language").notNull().default("pt-BR"),
  gamemode: integer("gamemode").notNull().default(1),
  baseRolls: integer("base_rolls").notNull().default(10),
  // Janela de rolls: floor((epochMin - reset_offset_min) / roll_interval_min)
  rollIntervalMin: integer("roll_interval_min").notNull().default(60),
  resetOffsetMin: integer("reset_offset_min").notNull().default(0),
  // A janela de pactos usa claim_cooldown_minutes como intervalo.
  claimCooldownMinutes: integer("claim_cooldown_minutes").notNull().default(180),
  pactsPerWindow: integer("pacts_per_window").notNull().default(1),
  claimWindowSeconds: integer("claim_window_seconds").notNull().default(45),
  snipeProtectionLevel: integer("snipe_protection_level").notNull().default(0),
  snipeProtectionSeconds: integer("snipe_protection_seconds").notNull().default(8),
  aetherSnipeProtectionLevel: integer("aether_snipe_protection_level").notNull().default(0),
  aetherSnipeProtectionSeconds: integer("aether_snipe_protection_seconds").notNull().default(8),
  pactLimit: integer("pact_limit").notNull().default(8100),
  serverAetherScrap: integer("server_aether_scrap").notNull().default(0),
  releaseBoostEnabled: boolean("release_boost_enabled").notNull().default(true),
  allowAdult: boolean("allow_adult").notNull().default(false),
  // Metadados do Discord (sincronizados pelo bot) e controle de versao da config para a dashboard.
  name: text("name"),
  icon: text("icon"),
  botPresent: boolean("bot_present").notNull().default(true),
  // Incrementado a cada escrita de configuracao (bot ou dashboard): invalida caches fora do processo.
  configVersion: integer("config_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Guild = typeof guilds.$inferSelect;
export type NewGuild = typeof guilds.$inferInsert;
