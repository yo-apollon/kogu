/**
 * Sincroniza nome, icone e presenca dos servidores para a tabela `guilds` (a dashboard exibe esses
 * metadados e lista so os servidores com `bot_present`). Nao mexe em configuracao: nao toca em
 * `config_version` nem em `updated_at`.
 *
 *  - ready: upsert de todas as guilds do client; as que sumiram enquanto o bot estava fora viram
 *    `bot_present = false`.
 *  - guildCreate / guildUpdate: nome, icone e `bot_present = true`.
 *  - guildDelete: `bot_present = false` (indisponibilidade temporaria do Discord, `available === false`,
 *    nao conta como saida).
 */
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Client, Guild } from "discord.js";
import { Events } from "discord.js";
import { getEnv } from "../config/env.js";
import type { Database } from "../infra/db/client.js";
import { guilds } from "../infra/db/schema/guilds.js";
import { childLogger } from "../lib/logger.js";

const log = childLogger("core:guildSync");

export interface GuildMeta {
  id: string;
  name: string | null;
  icon: string | null;
}

const UPSERT_CHUNK = 500;

/** Upsert de metadados; cria a linha com os padroes quando o servidor ainda nao existe. */
export async function upsertGuilds(db: Database, metas: readonly GuildMeta[]): Promise<void> {
  for (let i = 0; i < metas.length; i += UPSERT_CHUNK) {
    const chunk = metas.slice(i, i + UPSERT_CHUNK);
    await db
      .insert(guilds)
      .values(
        chunk.map((m) => ({
          id: m.id,
          prefix: getEnv().DEFAULT_PREFIX,
          name: m.name,
          icon: m.icon,
          botPresent: true,
        }))
      )
      .onConflictDoUpdate({
        target: guilds.id,
        set: { name: sql`excluded.name`, icon: sql`excluded.icon`, botPresent: true },
        setWhere: sql`${guilds.name} IS DISTINCT FROM excluded.name
          OR ${guilds.icon} IS DISTINCT FROM excluded.icon
          OR ${guilds.botPresent} = false`,
      });
  }
}

/** Marca o servidor como sem o bot (a linha e os dados permanecem). */
export async function markGuildAbsent(db: Database, guildId: string): Promise<void> {
  await db
    .update(guilds)
    .set({ botPresent: false })
    .where(and(eq(guilds.id, guildId), eq(guilds.botPresent, true)));
}

/** Servidores conhecidos que nao estao em `presentIds` passam a `bot_present = false`. */
export async function markMissingGuildsAbsent(
  db: Database,
  presentIds: readonly string[]
): Promise<void> {
  if (presentIds.length === 0) return;
  await db
    .update(guilds)
    .set({ botPresent: false })
    .where(and(eq(guilds.botPresent, true), notInArray(guilds.id, [...presentIds])));
}

export function guildMeta(guild: Pick<Guild, "id" | "name" | "icon">): GuildMeta {
  return { id: guild.id, name: guild.name, icon: guild.icon };
}

/** Liga os eventos ao client. Falhas sao logadas: sincronizacao de metadados nunca derruba o bot. */
export function registerGuildSync(client: Client, db: Database): void {
  const safe = (what: string, work: () => Promise<void>): void => {
    work().catch((err: unknown) => log.warn({ err }, `falha ao sincronizar guilds (${what})`));
  };

  client.once(Events.ClientReady, (ready) => {
    const metas = [...ready.guilds.cache.values()].map(guildMeta);
    safe("ready", async () => {
      await upsertGuilds(db, metas);
      await markMissingGuildsAbsent(
        db,
        metas.map((m) => m.id)
      );
    });
  });
  client.on(Events.GuildCreate, (guild) => {
    safe("guildCreate", () => upsertGuilds(db, [guildMeta(guild)]));
  });
  client.on(Events.GuildUpdate, (_old, guild) => {
    safe("guildUpdate", () => upsertGuilds(db, [guildMeta(guild)]));
  });
  client.on(Events.GuildDelete, (guild) => {
    if (!guild.available) return; // queda temporaria do Discord, nao uma saida
    safe("guildDelete", () => markGuildAbsent(db, guild.id));
  });
}