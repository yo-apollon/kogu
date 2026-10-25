import "server-only";
import { notFound, redirect } from "next/navigation";
import * as React from "react";
import type { Session } from "next-auth";
import { ownerIds } from "@/lib/env";
import { auth, getServerCredentials, type ServerCredentials } from "./auth";
import { DiscordUnauthorizedError, type GuildPerms } from "./discord";
import { listAccessibleGuilds, type AccessibleGuild } from "./guilds";

/**
 * Autorizacao server-side. REGRAS:
 *  - Chame no TOPO de TODA page, layout, route handler e Server Action (nunca confie so no layout:
 *    layouts nao rerrenderizam em navegacao client-side e actions sao endpoints POST publicos).
 *  - O userId vem SEMPRE da sessao (JWE); nenhuma funcao aceita userId por parametro.
 *  - Guilda fora da intersecao (Discord ∩ bot_present) e guilda onde falta o nivel pedido respondem 404
 *    (notFound), nao 403: nao revela quais servidores/rotas de admin existem.
 *  - Em escritas use as variantes `...Fresh`: rebuscam as permissoes no Discord sem o cache de 60 s.
 *  - O access_token nunca sai deste modulo: os contextos devolvidos nao o carregam.
 */

export interface SessionContext {
  session: Session;
  userId: string;
}

export interface GuildContext extends SessionContext {
  guild: AccessibleGuild;
  perms: GuildPerms;
}

export type GuildLevel = "member" | "manager" | "admin";

interface Identity extends SessionContext {
  credentials: ServerCredentials;
}

export interface AuthzDeps {
  loadIdentity(): Promise<Identity | null>;
  listGuilds(identity: Identity, fresh: boolean): Promise<AccessibleGuild[]>;
  ownerIds(): string[];
}

// `cache` do React deduplica por requisicao (RSC); fora do servidor RSC pode nao existir.
const memo: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R =
  (React as unknown as { cache?: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R })
    .cache ?? ((fn) => fn);

const loadIdentity = memo(async (): Promise<Identity | null> => {
  const [session, credentials] = await Promise.all([auth(), getServerCredentials()]);
  const id = session?.user?.id;
  // Sessao e token precisam concordar e estar validos (token Discord vencido => novo login).
  if (!session || !id || !credentials || credentials.userId !== id) return null;
  return { session, userId: id, credentials };
});

const listGuildsCached = memo((identity: Identity) => listAccessibleGuilds(identity.credentials));

const defaultDeps: AuthzDeps = {
  loadIdentity,
  listGuilds: (identity, fresh) =>
    fresh ? listAccessibleGuilds(identity.credentials, { fresh: true }) : listGuildsCached(identity),
  ownerIds: () => ownerIds(),
};

const GUILD_ID_RE = /^\d{1,25}$/;

async function identityOrLogin(deps: AuthzDeps): Promise<Identity> {
  const identity = await deps.loadIdentity();
  if (!identity) redirect("/login");
  return identity;
}

function publicContext(identity: Identity): SessionContext {
  return { session: identity.session, userId: identity.userId };
}

/** Exige sessao valida; senao redireciona para /login. */
export async function requireSession(deps: AuthzDeps = defaultDeps): Promise<SessionContext> {
  return publicContext(await identityOrLogin(deps));
}

export async function authorizeGuild(
  guildId: string,
  level: GuildLevel,
  opts: { fresh?: boolean } = {},
  deps: AuthzDeps = defaultDeps
): Promise<GuildContext> {
  const identity = await identityOrLogin(deps);
  if (!GUILD_ID_RE.test(guildId)) notFound();

  let guilds: AccessibleGuild[];
  try {
    guilds = await deps.listGuilds(identity, opts.fresh === true);
  } catch (err) {
    if (err instanceof DiscordUnauthorizedError) redirect("/login");
    throw err;
  }

  const guild = guilds.find((g) => g.id === guildId);
  if (!guild) notFound();
  const perms: GuildPerms = { isAdmin: guild.isAdmin, canManage: guild.canManage };
  if (level === "manager" && !perms.canManage) notFound();
  if (level === "admin" && !perms.isAdmin) notFound();
  return { ...publicContext(identity), guild, perms };
}

/** Jogador: qualquer membro do servidor onde o bot esta presente. */
export const requireGuildMember = (guildId: string) => authorizeGuild(guildId, "member");
/** Gerenciar servidor (MANAGE_GUILD 0x20, ADMINISTRATOR 0x8 ou dono): configuracoes. */
export const requireGuildManager = (guildId: string) => authorizeGuild(guildId, "manager");
/** ADMINISTRATOR (0x8) ou dono: escrita de serie server-wide. */
export const requireGuildAdmin = (guildId: string) => authorizeGuild(guildId, "admin");

/** Variantes para ESCRITAS: permissao rebuscada no Discord, sem cache. */
export const requireGuildMemberFresh = (guildId: string) =>
  authorizeGuild(guildId, "member", { fresh: true });
export const requireGuildManagerFresh = (guildId: string) =>
  authorizeGuild(guildId, "manager", { fresh: true });
export const requireGuildAdminFresh = (guildId: string) =>
  authorizeGuild(guildId, "admin", { fresh: true });

/** Staff (fase C futura): so IDs em OWNER_IDS. Outros recebem 404. */
export async function requireStaff(deps: AuthzDeps = defaultDeps): Promise<SessionContext> {
  const identity = await identityOrLogin(deps);
  if (!deps.ownerIds().includes(identity.userId)) notFound();
  return publicContext(identity);
}
