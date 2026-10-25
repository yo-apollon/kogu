import "server-only";
import { z } from "zod";

export const GUILDS_URL = "https://discord.com/api/v10/users/@me/guilds";
export const GUILD_CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
const MAX_RETRY_WAIT_MS = 3_000;
const MAX_ATTEMPTS = 3;

const PERM_ADMINISTRATOR = 0x8n;
const PERM_MANAGE_GUILD = 0x20n;

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: bigint;
}

export interface GuildPerms {
  isAdmin: boolean;
  canManage: boolean;
}

export class DiscordUnauthorizedError extends Error {
  constructor() {
    super("Token do Discord invalido ou expirado");
    this.name = "DiscordUnauthorizedError";
  }
}

export class DiscordRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Discord limitou as requisicoes");
    this.name = "DiscordRateLimitedError";
  }
}

export class DiscordApiError extends Error {
  constructor(readonly status: number) {
    super(`Discord respondeu ${status}`);
    this.name = "DiscordApiError";
  }
}

const rawGuildSchema = z.object({
  id: z.string().regex(/^\d{1,25}$/),
  name: z.string(),
  icon: z.string().nullable().optional(),
  owner: z.boolean().optional(),
  // A API v10 devolve as permissoes como string decimal (64 bits nao cabem em number).
  permissions: z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]),
});

/** Permissoes efetivas do usuario na guilda. Admin = ADMINISTRATOR ou dono; manage = admin ou MANAGE_GUILD. */
export function permsOf(g: Pick<DiscordGuild, "owner" | "permissions">): GuildPerms {
  const isAdmin = g.owner || (g.permissions & PERM_ADMINISTRATOR) !== 0n;
  const canManage = isAdmin || (g.permissions & PERM_MANAGE_GUILD) !== 0n;
  return { isAdmin, canManage };
}

export function parseGuilds(json: unknown): DiscordGuild[] {
  const arr = z.array(rawGuildSchema).parse(json);
  return arr.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon ?? null,
    owner: g.owner === true,
    permissions: BigInt(g.permissions),
  }));
}

export interface DiscordDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cache?: Map<string, CacheEntry>;
}

interface CacheEntry {
  expiresAt: number;
  guilds: DiscordGuild[];
}

const defaultCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DiscordGuild[]>>();

function parseRetryAfterMs(res: Response, body: unknown): number {
  const fromBody =
    typeof body === "object" && body !== null && "retry_after" in body
      ? Number((body as { retry_after: unknown }).retry_after)
      : NaN;
  const fromHeader = Number(res.headers.get("retry-after"));
  const sec = Number.isFinite(fromBody) ? fromBody : Number.isFinite(fromHeader) ? fromHeader : 1;
  return Math.max(0, Math.ceil(sec * 1000));
}

/** Busca sem cache. 401 -> DiscordUnauthorizedError; 429 -> espera `retry_after` (se curto) e tenta de novo. */
async function fetchGuilds(accessToken: string, deps: DiscordDeps): Promise<DiscordGuild[]> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch(GUILDS_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401) throw new DiscordUnauthorizedError();
    if (res.status === 429) {
      const body: unknown = await res.json().catch(() => null);
      const waitMs = parseRetryAfterMs(res, body);
      if (attempt >= MAX_ATTEMPTS || waitMs > MAX_RETRY_WAIT_MS) {
        throw new DiscordRateLimitedError(waitMs);
      }
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) throw new DiscordApiError(res.status);
    return parseGuilds(await res.json());
  }
}

function prune(cache: Map<string, CacheEntry>, now: number) {
  if (cache.size < CACHE_MAX_ENTRIES) return;
  for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  // Ainda cheio: descarta o mais antigo (ordem de insercao do Map).
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const first = cache.keys().next();
    if (first.done) break;
    cache.delete(first.value);
  }
}

/**
 * Guildas do usuario com cache de 60 s em memoria, por `userId`. A chave NUNCA contem o token.
 * (Em serverless o cache e por instancia; serve para rajadas de navegacao, nao como garantia.)
 */
export async function getUserGuilds(
  userId: string,
  accessToken: string,
  deps: DiscordDeps = {}
): Promise<DiscordGuild[]> {
  const cache = deps.cache ?? defaultCache;
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.guilds;

  const key = `${userId}`;
  const pending = deps.cache ? undefined : inflight.get(key);
  if (pending) return pending;

  const run = fetchGuilds(accessToken, deps).then((guilds) => {
    prune(cache, now);
    cache.set(userId, { expiresAt: now + GUILD_CACHE_TTL_MS, guilds });
    return guilds;
  });
  if (!deps.cache) {
    inflight.set(key, run);
    run.then(
      () => inflight.delete(key),
      () => inflight.delete(key)
    );
  }
  return run;
}

/** Sem cache (leitura): usar nas escritas, onde permissao revogada precisa valer na hora. */
export async function getFreshUserGuilds(
  userId: string,
  accessToken: string,
  deps: DiscordDeps = {}
): Promise<DiscordGuild[]> {
  const guilds = await fetchGuilds(accessToken, deps);
  // Aproveita a resposta fresca para atualizar o cache de leituras.
  const cache = deps.cache ?? defaultCache;
  const now = (deps.now ?? Date.now)();
  prune(cache, now);
  cache.set(userId, { expiresAt: now + GUILD_CACHE_TTL_MS, guilds });
  return guilds;
}

/** Limpa o cache (testes / logout). */
export function clearGuildCache(userId?: string, cache: Map<string, CacheEntry> = defaultCache) {
  if (userId) cache.delete(userId);
  else cache.clear();
}
