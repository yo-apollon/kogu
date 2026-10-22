import { bigint, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { guilds } from "./guilds.js";
import { users } from "./users.js";

/** Perfil do jogador no servidor (substitui guild_profiles). */
export const guildMembers = pgTable(
  "guild_members",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    aetherBalance: bigint("aether_balance", { mode: "number" }).notNull().default(0),
    astralShards: integer("astral_shards").notNull().default(0),
    // Rolls consumidos na janela `rolls_window`; janela diferente da atual = contador zerado.
    rollsUsed: integer("rolls_used").notNull().default(0),
    rollsWindow: integer("rolls_window").notNull().default(-1),
    stackedRolls: integer("stacked_rolls").notNull().default(0),
    pactsUsed: integer("pacts_used").notNull().default(0),
    pactWindow: integer("pact_window").notNull().default(-1),
    embedColor: text("embed_color").default("#5865F2"),
    relicBronze: integer("relic_bronze").notNull().default(0),
    relicSilver: integer("relic_silver").notNull().default(0),
    relicGold: integer("relic_gold").notNull().default(0),
    relicSapphire: integer("relic_sapphire").notNull().default(0),
    relicRuby: integer("relic_ruby").notNull().default(0),
    relicEmerald: integer("relic_emerald").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.guildId, t.userId], name: "guild_members_pk" }),
    userIdx: index("idx_guild_members_user").on(t.userId),
  })
);

export type GuildMember = typeof guildMembers.$inferSelect;
export type NewGuildMember = typeof guildMembers.$inferInsert;
