/**
 * Servico de configuracao do servidor e de series desativadas.
 *
 * Configuracao ($setrolls, $settimer, $setclaim, $gamemode, $prefix, $lang):
 *   valida com zod -> grava em `guilds` (um UPSERT) -> invalida o cache do guildConfig
 *   (`kv.del` + evento `guild:config:invalidate`) -> se a escala das janelas mudou ($settimer altera
 *   `claim_cooldown_minutes`), zera as janelas dos membros (`resetGuildWindows`).
 *   A invalidacao vem ANTES do reset: assim o proximo consumo ja calcula a janela pela escala nova.
 *
 * Series desativadas ($disable, $antidisable, $disablelist): por usuario ou `server-wide` (so admin),
 *   alvo = serie OU franquia (CHECK no banco). Toda mudanca chama `invalidateDisabledCache`.
 *
 * Sem SELECT *: toda query lista colunas.
 */
import { PermissionFlagsBits } from "discord.js";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Locale } from "../../config/constants.js";
import { getEnv } from "../../config/env.js";
import { guildConfigKey } from "../../core/middleware/guildConfig.js";
import { getLocale } from "../../i18n/index.js";
import { db } from "../../infra/db/client.js";
import { disabledSeries, franchises, guilds, series } from "../../infra/db/schema/index.js";
import { cacheGetOrSet, cacheKey } from "../../infra/redis/cache.js";
import { getKV } from "../../infra/redis/client.js";
import type { KV } from "../../infra/redis/kv.js";
import { publishEvent } from "../../infra/redis/pubsub.js";
import { UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import {
  RESETS_WINDOWS,
  SETTING_LIMITS,
  SETTING_KEYS,
  limitsOf,
  patchFor,
  settingSchemas,
  type SettingKey,
  type SettingValues,
} from "../../shared/guildSettings.js";
import { trigramMatch, trigramScore } from "../../shared/search.js";
import { normalizeName } from "../../shared/text.js";
import { ensureUser, type Executor } from "../economy/service.js";
import { invalidateDisabledCache } from "../summon/rollEngine.js";
import { resetGuildWindows } from "../summon/service.js";

const log = childLogger("config:service");

// ---------------------------------------------------------------------------
// Configuracao do servidor
// ---------------------------------------------------------------------------

// Validadores e limites em src/shared/guildSettings.ts (copiado para a dashboard).
export { SETTING_KEYS, SETTING_LIMITS, settingSchemas };
export type { SettingKey, SettingValues };

/** Chave i18n da mensagem de uso invalido de cada configuracao. */
const INVALID_KEY: Record<SettingKey, string> = {
  rolls: "config.setrolls_invalid",
  timer: "config.settimer_invalid",
  claim: "config.setclaim_invalid",
  gamemode: "config.gamemode_invalid",
  prefix: "config.prefix_invalid",
  lang: "config.lang_usage",
};

/**
 * Valida `raw` para a configuracao `key`. Valor invalido lanca `UserError` com a mensagem de uso
 * (`config.*_invalid` / `config.lang_usage`); `prefix` e o prefixo atual, usado nos exemplos.
 */
export function parseSetting<K extends SettingKey>(
  key: K,
  raw: unknown,
  prefix: string
): SettingValues[K] {
  const result = settingSchemas[key].safeParse(raw);
  if (result.success) return result.data as SettingValues[K];
  const { min, max } = limitsOf(key);
  throw new UserError(INVALID_KEY[key], { min, max, prefix });
}

/** Avisa todas as instancias (e limpa o KV) de que a config da guilda mudou. */
export async function invalidateGuildConfig(guildId: string, kv?: KV): Promise<void> {
  const store = kv ?? (await getKV());
  await store.del(guildConfigKey(guildId));
  await publishEvent(store, "guild:config:invalidate", { guildId });
}

export interface AppliedSetting<K extends SettingKey = SettingKey> {
  key: K;
  value: SettingValues[K];
  /** As janelas de rolls/pactos dos membros foram zeradas. */
  windowsReset: boolean;
}

/**
 * Valida, grava e propaga uma configuracao do servidor. Permissao (Manage Guild) e conferida antes,
 * pelo middleware `permissions` do comando.
 */
export async function applyGuildSetting<K extends SettingKey>(
  guildId: string,
  key: K,
  raw: unknown,
  opts: { prefix: string }
): Promise<AppliedSetting<K>> {
  const value = parseSetting(key, raw, opts.prefix);
  const patch = patchFor(key, value);

  await db
    .insert(guilds)
    .values({ id: guildId, prefix: getEnv().DEFAULT_PREFIX, ...patch, configVersion: 1 })
    .onConflictDoUpdate({
      target: guilds.id,
      // config_version na mesma escrita: processos fora do bot (dashboard) detectam a mudanca por ele.
      set: { ...patch, updatedAt: new Date(), configVersion: sql`${guilds.configVersion} + 1` },
    });

  await invalidateGuildConfig(guildId);
  const windowsReset = RESETS_WINDOWS.has(key);
  if (windowsReset) await resetGuildWindows(guildId);
  return { key, value, windowsReset };
}

export interface GuildSettings {
  id: string;
  prefix: string;
  locale: Locale;
  gamemode: number;
  baseRolls: number;
  rollIntervalMin: number;
  resetOffsetMin: number;
  claimCooldownMinutes: number;
  pactsPerWindow: number;
  claimWindowSeconds: number;
  snipeProtectionLevel: number;
  snipeProtectionSeconds: number;
  aetherSnipeProtectionLevel: number;
  aetherSnipeProtectionSeconds: number;
  pactLimit: number;
  releaseBoostEnabled: boolean;
  allowAdult: boolean;
}

const settingsColumns = {
  id: guilds.id,
  prefix: guilds.prefix,
  language: guilds.language,
  gamemode: guilds.gamemode,
  baseRolls: guilds.baseRolls,
  rollIntervalMin: guilds.rollIntervalMin,
  resetOffsetMin: guilds.resetOffsetMin,
  claimCooldownMinutes: guilds.claimCooldownMinutes,
  pactsPerWindow: guilds.pactsPerWindow,
  claimWindowSeconds: guilds.claimWindowSeconds,
  snipeProtectionLevel: guilds.snipeProtectionLevel,
  snipeProtectionSeconds: guilds.snipeProtectionSeconds,
  aetherSnipeProtectionLevel: guilds.aetherSnipeProtectionLevel,
  aetherSnipeProtectionSeconds: guilds.aetherSnipeProtectionSeconds,
  pactLimit: guilds.pactLimit,
  releaseBoostEnabled: guilds.releaseBoostEnabled,
  allowAdult: guilds.allowAdult,
};

/** Configuracao completa da guilda (cria a linha com os padroes se ainda nao existir). */
export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const select = () =>
    db.select(settingsColumns).from(guilds).where(eq(guilds.id, guildId)).limit(1);
  let [row] = await select();
  if (!row) {
    await db
      .insert(guilds)
      .values({ id: guildId, prefix: getEnv().DEFAULT_PREFIX })
      .onConflictDoNothing({ target: guilds.id });
    [row] = await select();
  }
  if (!row) throw new Error(`falha ao criar/ler a linha de guilds para ${guildId}`);
  const { language, ...rest } = row;
  return { ...rest, locale: getLocale(language) };
}

// ---------------------------------------------------------------------------
// Series e franquias desativadas
// ---------------------------------------------------------------------------

export type TargetKind = "series" | "franchise";

export interface DisableTarget {
  kind: TargetKind;
  id: number;
  name: string;
}

export interface DisabledEntry extends DisableTarget {
  serverWide: boolean;
  createdAt: Date;
}

export const TARGET_AUTOCOMPLETE_LIMIT = 25;
export const TARGET_AUTOCOMPLETE_CACHE_MS = 60_000;
export const DISABLE_PAGE_SIZE = 15;
const MAX_SEARCH_TOKENS = 6;

export type TargetRef = { kind: TargetKind; id: number } | { kind: "text"; text: string };

const TARGET_RE = /^([sf]):(\d{1,15})$/;

/** Valor do autocomplete: `s:<seriesId>` ou `f:<franchiseId>`. */
export function targetRefValue(target: Pick<DisableTarget, "kind" | "id">): string {
  return `${target.kind === "series" ? "s" : "f"}:${target.id}`;
}

export function parseTargetRef(raw: string): TargetRef {
  const text = raw.trim();
  const match = TARGET_RE.exec(text);
  if (match) return { kind: match[1] === "s" ? "series" : "franchise", id: Number(match[2]) };
  return { kind: "text", text };
}

/** Somente Administrador altera as series desativadas do servidor inteiro. */
export function assertCanManageServerWide(
  member: { permissions: { has(permission: bigint): boolean } } | null | undefined
): void {
  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new UserError("errors.missing_administrator");
  }
}

function queryTokens(query: string): { q: string; tokens: string[] } {
  const q = normalizeName(query);
  const tokens = q === "" ? [] : q.split(" ").slice(0, MAX_SEARCH_TOKENS);
  return { q, tokens };
}

interface ScoredTarget extends DisableTarget {
  exact: boolean;
  sim: number;
}

/**
 * Series (`title`) e franquias (`name`) que combinam com `query`, melhores primeiro: igualdade exata,
 * depois similaridade de trigramas (`%` / `similarity`) ou todos os tokens como substring (`ILIKE`).
 */
export async function searchTargets(
  query: string,
  opts: { limit?: number; exec?: Executor } = {}
): Promise<DisableTarget[]> {
  const exec = opts.exec ?? db;
  const limit = Math.min(
    Math.max(1, Math.floor(opts.limit ?? TARGET_AUTOCOMPLETE_LIMIT)),
    TARGET_AUTOCOMPLETE_LIMIT
  );
  const { q, tokens } = queryTokens(query);
  if (tokens.length === 0) return [];

  // `%` e `<%` (similaridade com um trecho do titulo) cobrem erros de digitacao; os `ILIKE` por token
  // cobrem digitacao parcial. Os tres usam o indice GIN trigram.
  const match = (column: typeof series.title | typeof franchises.name) =>
    trigramMatch(column, q, tokens, true);
  const score = (column: typeof series.title | typeof franchises.name) => trigramScore(column, q);

  const [seriesRows, franchiseRows] = await Promise.all([
    exec
      .select({ id: series.id, name: series.title, sim: score(series.title) })
      .from(series)
      .where(match(series.title))
      .orderBy(sql`${score(series.title)} DESC`, asc(series.id))
      .limit(limit),
    exec
      .select({ id: franchises.id, name: franchises.name, sim: score(franchises.name) })
      .from(franchises)
      .where(match(franchises.name))
      .orderBy(sql`${score(franchises.name)} DESC`, asc(franchises.id))
      .limit(limit),
  ]);

  const scored: ScoredTarget[] = [
    ...seriesRows.map((r) => ({ kind: "series" as const, ...r })),
    ...franchiseRows.map((r) => ({ kind: "franchise" as const, ...r })),
  ].map((r) => ({
    kind: r.kind,
    id: r.id,
    name: r.name,
    exact: normalizeName(r.name) === q,
    sim: Number(r.sim),
  }));
  // sort e estavel: em empate, series vem antes de franquias.
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.sim - a.sim);
  return scored.slice(0, limit).map(({ kind, id, name }) => ({ kind, id, name }));
}

/** Serie ou franquia por id. */
export async function getTarget(
  kind: TargetKind,
  id: number,
  exec: Executor = db
): Promise<DisableTarget | null> {
  if (kind === "series") {
    const [row] = await exec
      .select({ id: series.id, name: series.title })
      .from(series)
      .where(eq(series.id, id))
      .limit(1);
    return row ? { kind, ...row } : null;
  }
  const [row] = await exec
    .select({ id: franchises.id, name: franchises.name })
    .from(franchises)
    .where(eq(franchises.id, id))
    .limit(1);
  return row ? { kind, ...row } : null;
}

/** Resolve `s:N` / `f:N` (autocomplete) ou o nome digitado para uma serie/franquia do catalogo. */
export async function resolveTarget(raw: string): Promise<DisableTarget | null> {
  const ref = parseTargetRef(raw);
  if (ref.kind !== "text") return getTarget(ref.kind, ref.id);
  const [best] = await searchTargets(ref.text, { limit: 1 });
  return best ?? null;
}

/** Autocomplete de `/disable add`, com cache de 60 s por consulta normalizada. */
export async function autocompleteTargets(
  kv: KV,
  query: string,
  deps: { search?: typeof searchTargets } = {}
): Promise<DisableTarget[]> {
  const search = deps.search ?? searchTargets;
  const { q } = queryTokens(query);
  if (q.length < 2) return [];
  const load = () => search(query, { limit: TARGET_AUTOCOMPLETE_LIMIT });
  try {
    return await cacheGetOrSet(
      kv,
      cacheKey("ac", "series", q),
      TARGET_AUTOCOMPLETE_CACHE_MS,
      load
    );
  } catch (err) {
    log.warn({ err }, "cache do autocomplete indisponivel; consultando o banco");
    return load();
  }
}

function targetCondition(target: Pick<DisableTarget, "kind" | "id">): SQL {
  return target.kind === "series"
    ? eq(disabledSeries.seriesId, target.id)
    : eq(disabledSeries.franchiseId, target.id);
}

function scopeCondition(guildId: string, userId: string, serverWide: boolean): SQL | undefined {
  return serverWide
    ? and(eq(disabledSeries.guildId, guildId), eq(disabledSeries.isServerWide, true))
    : and(
        eq(disabledSeries.guildId, guildId),
        eq(disabledSeries.userId, userId),
        eq(disabledSeries.isServerWide, false)
      );
}

export interface DisableInput {
  guildId: string;
  userId: string;
  username?: string;
  target: DisableTarget;
  serverWide?: boolean;
}

/**
 * Desativa a serie/franquia para o usuario (ou para o servidor). `created: false` se ja estava.
 * A permissao de Administrador para `serverWide` e conferida por quem chama (`assertCanManageServerWide`).
 */
export async function disableTarget(input: DisableInput): Promise<{ created: boolean }> {
  const { guildId, userId, target } = input;
  const serverWide = input.serverWide === true;
  const created = await db.transaction(async (tx) => {
    await tx.insert(guilds).values({ id: guildId }).onConflictDoNothing();
    await ensureUser(tx, userId, input.username);
    const [existing] = await tx
      .select({ id: disabledSeries.id })
      .from(disabledSeries)
      .where(and(scopeCondition(guildId, userId, serverWide), targetCondition(target)))
      .limit(1);
    if (existing) return false;
    const rows = await tx
      .insert(disabledSeries)
      .values({
        guildId,
        userId,
        isServerWide: serverWide,
        seriesId: target.kind === "series" ? target.id : null,
        franchiseId: target.kind === "franchise" ? target.id : null,
      })
      .onConflictDoNothing()
      .returning({ id: disabledSeries.id });
    return rows.length > 0;
  });
  if (created) await invalidateDisabledCache(guildId, serverWide ? undefined : userId);
  return { created };
}

/** Reativa a serie/franquia. Devolve quantas linhas foram removidas (0 = nao estava desativada). */
export async function enableTarget(input: DisableInput): Promise<number> {
  const { guildId, userId, target } = input;
  const serverWide = input.serverWide === true;
  const rows = await db
    .delete(disabledSeries)
    .where(and(scopeCondition(guildId, userId, serverWide), targetCondition(target)))
    .returning({ id: disabledSeries.id });
  if (rows.length > 0) await invalidateDisabledCache(guildId, serverWide ? undefined : userId);
  return rows.length;
}

/** Desativadas do usuario (ou do servidor, sem repeticao entre admins), mais recentes por ultimo. */
export async function listDisabled(
  guildId: string,
  userId: string,
  serverWide = false,
  exec: Executor = db
): Promise<DisabledEntry[]> {
  const rows = await exec
    .select({
      seriesId: disabledSeries.seriesId,
      franchiseId: disabledSeries.franchiseId,
      seriesTitle: series.title,
      franchiseName: franchises.name,
      createdAt: disabledSeries.createdAt,
    })
    .from(disabledSeries)
    .leftJoin(series, eq(series.id, disabledSeries.seriesId))
    .leftJoin(franchises, eq(franchises.id, disabledSeries.franchiseId))
    .where(scopeCondition(guildId, userId, serverWide))
    .orderBy(asc(disabledSeries.createdAt), asc(disabledSeries.id));

  const seen = new Set<string>();
  const out: DisabledEntry[] = [];
  for (const row of rows) {
    const target: DisableTarget | null =
      row.seriesId !== null && row.seriesTitle !== null
        ? { kind: "series", id: row.seriesId, name: row.seriesTitle }
        : row.franchiseId !== null && row.franchiseName !== null
          ? { kind: "franchise", id: row.franchiseId, name: row.franchiseName }
          : null;
    if (!target) continue;
    const key = targetRefValue(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...target, serverWide, createdAt: row.createdAt });
  }
  return out;
}

/** Entrada da lista que corresponde a `raw` (`s:N` / `f:N` ou nome; tokens contidos, melhor similaridade). */
export function findDisabledEntry(
  entries: readonly DisabledEntry[],
  raw: string
): DisabledEntry | undefined {
  const ref = parseTargetRef(raw);
  if (ref.kind !== "text") return entries.find((e) => e.kind === ref.kind && e.id === ref.id);
  const { q, tokens } = queryTokens(ref.text);
  if (tokens.length === 0) return undefined;
  const exact = entries.find((e) => normalizeName(e.name) === q);
  if (exact) return exact;
  return entries.find((e) => {
    const name = normalizeName(e.name);
    return tokens.every((tok) => name.includes(tok));
  });
}

/** Autocomplete de `/disable remove`: so o que ja esta desativado no escopo. */
export async function autocompleteDisabled(
  guildId: string,
  userId: string,
  serverWide: boolean,
  query: string
): Promise<DisabledEntry[]> {
  const entries = await listDisabled(guildId, userId, serverWide);
  const { tokens } = queryTokens(query);
  return entries
    .filter((e) => {
      const name = normalizeName(e.name);
      return tokens.every((tok) => name.includes(tok));
    })
    .slice(0, TARGET_AUTOCOMPLETE_LIMIT);
}
