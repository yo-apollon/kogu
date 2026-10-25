import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { guilds } from "@/generated/schema";
import { getRoDb, type Db } from "./db";
import {
  getFreshUserGuilds,
  getUserGuilds,
  permsOf,
  type DiscordDeps,
  type DiscordGuild,
  type GuildPerms,
} from "./discord";

export interface AccessibleGuild extends GuildPerms {
  id: string;
  name: string;
  icon: string | null;
}

export interface UserCredentials {
  userId: string;
  /** Token OAuth do Discord. Vive so no servidor; nunca entra em objeto devolvido a paginas. */
  accessToken: string;
}

export interface ListGuildsOptions {
  /** Ignora o cache de 60 s do Discord (use em escritas). */
  fresh?: boolean;
  db?: Db;
  discord?: DiscordDeps;
}

/**
 * Servidores acessiveis = guildas do usuario no Discord ∩ guildas onde o bot esta presente (banco).
 * Ordenado por nome. Fonte unica da verdade de "este usuario enxerga esta guilda".
 */
export async function listAccessibleGuilds(
  who: UserCredentials,
  opts: ListGuildsOptions = {}
): Promise<AccessibleGuild[]> {
  const fetchGuilds = opts.fresh ? getFreshUserGuilds : getUserGuilds;
  const discordGuilds = await fetchGuilds(who.userId, who.accessToken, opts.discord);
  if (discordGuilds.length === 0) return [];

  const byId = new Map<string, DiscordGuild>(discordGuilds.map((g) => [g.id, g]));
  const db = opts.db ?? getRoDb();
  // SELECT id, name, icon FROM guilds WHERE id IN (...) AND bot_present = true
  const rows = await db
    .select({ id: guilds.id, name: guilds.name, icon: guilds.icon })
    .from(guilds)
    .where(and(inArray(guilds.id, [...byId.keys()]), eq(guilds.botPresent, true)));

  const out: AccessibleGuild[] = [];
  for (const row of rows) {
    const dg = byId.get(row.id);
    if (!dg) continue;
    out.push({
      id: row.id,
      // O bot sincroniza nome/icone; ate la, cai para o que o Discord informou ao usuario.
      name: row.name ?? dg.name,
      icon: row.icon ?? dg.icon,
      ...permsOf(dg),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}
