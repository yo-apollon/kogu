// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cardVariantEnum } from "./enums";
import { guilds } from "./guilds";
import { users } from "./users";
import { entities } from "./catalog";
import { pacts } from "./collection";

const tz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Estado persistente de uma invocacao (substitui o coletor em memoria).
 * Os customIds `sm:pact|like|orb:<id>` apontam para esta linha, entao sobrevivem a reinicios.
 */
export const rollOffers = pgTable(
  "roll_offers",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"), // nulo ate a mensagem ser enviada
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    variant: cardVariantEnum("variant").notNull().default("STANDARD"),
    aetherValue: integer("aether_value").notNull().default(0),
    status: text("status").notNull().default("OPEN"),
    expiresAt: tz("expires_at").notNull(),
    // Ate este instante so o dono da invocacao pode reivindicar (snipe protection).
    protectedUntil: tz("protected_until"),
    claimedBy: text("claimed_by"),
    claimedAt: tz("claimed_at"),
    pactId: bigint("pact_id", { mode: "number" }).references(() => pacts.id, {
      onDelete: "set null",
    }),
    // Orbe de eter: valor sorteado na criacao; orb_claimed_by e a trava atomica.
    orbAether: integer("orb_aether"),
    orbClaimedBy: text("orb_claimed_by"),
    orbClaimedAt: tz("orb_claimed_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    messageUq: uniqueIndex("uq_roll_offers_message")
      .on(t.channelId, t.messageId)
      .where(sql`${t.messageId} IS NOT NULL`),
    // offers.sweep: so ofertas abertas.
    openExpiresIdx: index("idx_roll_offers_open_expires")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'OPEN'`),
    guildIdx: index("idx_roll_offers_guild").on(t.guildId, t.createdAt),
    entityIdx: index("idx_roll_offers_entity").on(t.entityId),
    // Historico de claims da dashboard (por jogador e por servidor): so ofertas reivindicadas.
    claimedByIdx: index("idx_roll_offers_claimed")
      .on(t.guildId, t.claimedBy, t.claimedAt.desc())
      .where(sql`${t.status} = 'CLAIMED'`),
    guildClaimedIdx: index("idx_roll_offers_guild_claimed")
      .on(t.guildId, t.claimedAt)
      .where(sql`${t.status} = 'CLAIMED'`),
  })
);

/** Historico de rolls (anti-repeticao e auditoria). Retencao de 30 dias via maintenance.prune. */
export const rollLog = pgTable(
  "roll_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    rolledAt: tz("rolled_at").notNull().defaultNow(),
  },
  (t) => ({
    guildRecentIdx: index("idx_roll_log_guild_recent").on(t.guildId, t.rolledAt.desc()),
    rolledAtIdx: index("idx_roll_log_rolled_at").on(t.rolledAt),
    guildUserRecentIdx: index("idx_roll_log_guild_user_recent").on(
      t.guildId,
      t.userId,
      t.rolledAt.desc()
    ),
  })
);

export type RollOffer = typeof rollOffers.$inferSelect;
export type NewRollOffer = typeof rollOffers.$inferInsert;
export type RollLogEntry = typeof rollLog.$inferSelect;
export type NewRollLogEntry = typeof rollLog.$inferInsert;
