/**
 * Consultas e operacoes do modulo ECONOMY que o `service.ts` (F9) nao cobre:
 * configuracao de timers, resumo de perfil, evolucao atomica de reliquias e ranking do servidor.
 * Somente colunas necessarias (sem SELECT *). Escritas passam por `db.transaction`.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import type { GuildConfig } from "../../core/contracts.js";
import { getLocale } from "../../i18n/index.js";
import { db } from "../../infra/db/client.js";
import {
  entities,
  entityImages,
  franchises,
  guildMembers,
  guilds,
  pacts,
  type NewGuildMember,
} from "../../infra/db/schema/index.js";
import { UserError } from "../../lib/errors.js";
import { formatNumber } from "../../ui/format.js";
import type { TimersGuildConfig } from "../summon/service.js";
import { pactAetherValue } from "../summon/variants.js";
import {
  planRelicUpgrade,
  RELIC_FIELD,
  relicLabel,
  relicLevelsOf,
  type RelicKey,
  type RelicLevels,
} from "./relics.js";
import { debit, ensureMember, type Executor } from "./service.js";

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

/**
 * `GuildConfig` (contrato do core) nao traz `pacts_per_window`; completa com uma leitura por PK
 * para montar o `TimersGuildConfig` que `getTimers` exige.
 */
export async function getTimersConfig(
  cfg: GuildConfig,
  exec: Executor = db
): Promise<TimersGuildConfig> {
  const [row] = await exec
    .select({ pactsPerWindow: guilds.pactsPerWindow })
    .from(guilds)
    .where(eq(guilds.id, cfg.id))
    .limit(1);
  return {
    baseRolls: cfg.baseRolls,
    rollIntervalMin: cfg.rollIntervalMin,
    resetOffsetMin: cfg.resetOffsetMin,
    claimCooldownMinutes: cfg.claimIntervalMin,
    pactsPerWindow: row?.pactsPerWindow ?? 1,
    prefix: cfg.prefix,
  };
}

/** Prefixo e idioma do servidor, para handlers de componente (que nao recebem o `GuildConfig`). */
export async function getGuildBasics(
  guildId: string,
  exec: Executor = db
): Promise<{ prefix: string; locale: Locale }> {
  const [row] = await exec
    .select({ prefix: guilds.prefix, language: guilds.language })
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1);
  return { prefix: row?.prefix ?? "$", locale: row ? getLocale(row.language) : DEFAULT_LOCALE };
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export interface MemberSnapshot {
  /** false = jogador ainda sem linha em guild_members (valores padrao). */
  exists: boolean;
  balance: number;
  astralShards: number;
  embedColor: string | null;
  relics: RelicLevels;
}

export async function getMemberSnapshot(
  guildId: string,
  userId: string,
  exec: Executor = db
): Promise<MemberSnapshot> {
  const [row] = await exec
    .select({
      balance: guildMembers.aetherBalance,
      astralShards: guildMembers.astralShards,
      embedColor: guildMembers.embedColor,
      relicBronze: guildMembers.relicBronze,
      relicSilver: guildMembers.relicSilver,
      relicGold: guildMembers.relicGold,
      relicSapphire: guildMembers.relicSapphire,
      relicRuby: guildMembers.relicRuby,
      relicEmerald: guildMembers.relicEmerald,
    })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);
  return {
    exists: Boolean(row),
    balance: row?.balance ?? 0,
    astralShards: row?.astralShards ?? 0,
    embedColor: row?.embedColor ?? null,
    relics: relicLevelsOf(row),
  };
}

export interface PantheonLeader {
  name: string;
  franchise: string | null;
  imageUrl: string | null;
  /** Valor atual do pacto (variante, selos e Eter da assinatura). */
  aether: number;
}

export interface PantheonSummary {
  /** Numero de pactos do jogador no servidor. */
  count: number;
  /** Soma dos Selos de Despertar. */
  awakeningKeys: number;
  /** Pactos com 10+ selos. */
  soulmates: number;
  /** Patrimonio: soma de max(Eter base, Eter na assinatura) de cada pacto. */
  worth: number;
  leader: PantheonLeader | null;
}

/** Agregado de pactos do jogador + o Lider do Panteao (menor `sort_order`, depois maior Eter). */
export async function getPantheonSummary(
  guildId: string,
  userId: string,
  exec: Executor = db
): Promise<PantheonSummary> {
  const owner = and(eq(pacts.guildId, guildId), eq(pacts.userId, userId));

  const aggregate = exec
    .select({
      count: sql<number>`count(*)::int`,
      keys: sql<number>`coalesce(sum(${pacts.awakeningKeys}), 0)::int`,
      soulmates: sql<number>`(count(*) filter (where ${pacts.awakeningKeys} >= 10))::int`,
      worth: sql<number>`coalesce(sum(greatest(${entities.baseAether}, ${pacts.aetherAtBind})), 0)::float8`,
    })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .where(owner);

  const leaderQuery = exec
    .select({
      name: entities.name,
      franchise: franchises.name,
      imageUrl: entityImages.url,
      baseAether: entities.baseAether,
      variant: pacts.variant,
      awakeningKeys: pacts.awakeningKeys,
      aetherAtBind: pacts.aetherAtBind,
    })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
    .leftJoin(
      entityImages,
      and(eq(entityImages.entityId, entities.id), eq(entityImages.isPrimary, true))
    )
    .where(owner)
    .orderBy(asc(pacts.sortOrder), desc(entities.baseAether), asc(pacts.id))
    .limit(1);

  const [[agg], [leader]] = await Promise.all([aggregate, leaderQuery]);
  return {
    count: agg?.count ?? 0,
    awakeningKeys: agg?.keys ?? 0,
    soulmates: agg?.soulmates ?? 0,
    worth: agg?.worth ?? 0,
    leader: leader
      ? {
          name: leader.name,
          franchise: leader.franchise,
          imageUrl: leader.imageUrl,
          aether: pactAetherValue(
            leader.baseAether,
            leader.variant,
            leader.awakeningKeys,
            leader.aetherAtBind
          ),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Reliquias
// ---------------------------------------------------------------------------

const RELIC_COLUMN = {
  bronze: guildMembers.relicBronze,
  silver: guildMembers.relicSilver,
  gold: guildMembers.relicGold,
  sapphire: guildMembers.relicSapphire,
  ruby: guildMembers.relicRuby,
  emerald: guildMembers.relicEmerald,
} as const;

export interface RelicUpgradeOptions {
  /** Nome atual no Discord (cria o usuario se for novo). */
  username?: string;
  /** Idioma das mensagens de erro (nome da reliquia). */
  locale?: string;
  /** Prefixo do servidor, citado na dica de `economy.relic_insufficient`. */
  prefix?: string;
}

export interface RelicUpgradeResult {
  key: RelicKey;
  fromLevel: number;
  toLevel: number;
  /** Eter debitado. */
  cost: number;
  /** Saldo apos o debito. */
  balance: number;
  /** Niveis de todas as reliquias apos a evolucao. */
  levels: RelicLevels;
}

/**
 * Evolui uma reliquia em UMA transacao: trava a linha do membro (`FOR UPDATE`), calcula o custo
 * (com o desconto do Rubi) sobre o estado travado, debita o saldo com o `debit` do service e sobe o
 * nivel. Se qualquer passo falhar, o saldo e o nivel voltam juntos. Chamadas concorrentes se
 * serializam: nunca ha debito sem nivel nem nivel sem debito, e o saldo nao fica negativo.
 *
 * Erros (UserError): `economy.relic_max` e `economy.relic_insufficient`.
 */
export async function upgradeRelic(
  guildId: string,
  userId: string,
  key: RelicKey,
  opts: RelicUpgradeOptions = {}
): Promise<RelicUpgradeResult> {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const pk = and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId));

  return db.transaction(async (tx) => {
    const lockMember = () =>
      tx
        .select({
          balance: guildMembers.aetherBalance,
          relicBronze: guildMembers.relicBronze,
          relicSilver: guildMembers.relicSilver,
          relicGold: guildMembers.relicGold,
          relicSapphire: guildMembers.relicSapphire,
          relicRuby: guildMembers.relicRuby,
          relicEmerald: guildMembers.relicEmerald,
        })
        .from(guildMembers)
        .where(pk)
        .for("update");

    let [row] = await lockMember();
    if (!row) {
      await ensureMember(tx, { guildId, userId, username: opts.username });
      [row] = await lockMember();
    }
    if (!row) throw new Error("falha ao criar/ler guild_members para evoluir reliquia");

    const levels = relicLevelsOf(row);
    const plan = planRelicUpgrade(levels, row.balance, key);
    if (plan.kind === "max") {
      throw new UserError("economy.relic_max", { name: relicLabel(key, locale) });
    }
    if (plan.kind === "insufficient") {
      throw new UserError("economy.relic_insufficient", {
        cost: formatNumber(plan.cost, locale),
        balance: formatNumber(plan.balance, locale),
        prefix: opts.prefix ?? "$",
      });
    }

    const balance = await debit(guildId, userId, plan.cost, { exec: tx });

    const column = RELIC_COLUMN[key];
    const [updated] = await tx
      .update(guildMembers)
      .set({ [RELIC_FIELD[key]]: sql`${column} + 1` } as Partial<NewGuildMember>)
      .where(and(pk, eq(column, plan.fromLevel)))
      .returning({ level: column });
    // Impossivel com a linha travada; se ocorrer, aborta e desfaz o debito.
    if (!updated) throw new Error("estado da reliquia mudou durante a evolucao");

    return {
      key,
      fromLevel: plan.fromLevel,
      toLevel: updated.level,
      cost: plan.cost,
      balance,
      levels: { ...levels, [key]: updated.level },
    };
  });
}

// ---------------------------------------------------------------------------
// Ranking do servidor
// ---------------------------------------------------------------------------

export const TOP_MODES = ["aether", "pacts"] as const;
export type TopMode = (typeof TOP_MODES)[number];

export interface RankRow {
  /** Posicao no ranking (base 1), contando a pagina. */
  rank: number;
  userId: string;
  /** Eter (mode aether) ou numero de pactos (mode pacts). */
  value: number;
}

export interface RankPage {
  rows: RankRow[];
  /** Total de jogadores ranqueados. */
  total: number;
}

/**
 * Pagina do ranking do servidor. Ordem estavel: valor decrescente, desempate por `user_id`.
 * Eter: `guild_members`; pactos: `GROUP BY user_id` em `pacts` (so quem tem pacto aparece).
 * Consultas agregadas com LIMIT/OFFSET, sem trazer a tabela inteira.
 */
export async function getTopPage(
  guildId: string,
  mode: TopMode,
  page: number,
  pageSize: number,
  exec: Executor = db
): Promise<RankPage> {
  const size = Math.max(1, Math.floor(pageSize));
  const offset = (Math.max(1, Math.floor(page)) - 1) * size;

  if (mode === "pacts") {
    const [rows, [count]] = await Promise.all([
      exec
        .select({ userId: pacts.userId, value: sql<number>`count(*)::int` })
        .from(pacts)
        .where(eq(pacts.guildId, guildId))
        .groupBy(pacts.userId)
        .orderBy(sql`count(*) desc`, asc(pacts.userId))
        .limit(size)
        .offset(offset),
      exec
        .select({ total: sql<number>`count(distinct ${pacts.userId})::int` })
        .from(pacts)
        .where(eq(pacts.guildId, guildId)),
    ]);
    return {
      rows: rows.map((r, i) => ({ rank: offset + i + 1, userId: r.userId, value: r.value })),
      total: count?.total ?? 0,
    };
  }

  const [rows, [count]] = await Promise.all([
    exec
      .select({ userId: guildMembers.userId, value: guildMembers.aetherBalance })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId))
      .orderBy(desc(guildMembers.aetherBalance), asc(guildMembers.userId))
      .limit(size)
      .offset(offset),
    exec
      .select({ total: sql<number>`count(*)::int` })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId)),
  ]);
  return {
    rows: rows.map((r, i) => ({ rank: offset + i + 1, userId: r.userId, value: r.value })),
    total: count?.total ?? 0,
  };
}
