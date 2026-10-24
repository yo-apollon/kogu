/**
 * Builders SQL puros do Panteao (filtros, ordenacao e valor de um pacto). Dependem apenas do schema,
 * de `config/gacha.ts` e do drizzle-orm: copiados para a dashboard.
 */
import { and, asc, desc, eq, like, not, or, sql, type SQL } from "drizzle-orm";
import {
  AWAKENING_BONUS_AFTER_10,
  AWAKENING_BONUS_AT,
  AWAKENING_BONUS_STEP,
  VARIANT_MULTIPLIER,
  type CardVariant,
} from "../config/gacha.js";
import { entities, franchises, series } from "../infra/db/schema/catalog.js";
import { pacts } from "../infra/db/schema/collection.js";
import { escapeLike, nameTokens } from "./text.js";

type EntityGender = (typeof entities.$inferSelect)["gender"];
type EntityUniverse = (typeof entities.$inferSelect)["universe"];

/** Pacto com este numero de selos (ou mais) conta como alma gemea. */
export const SOULMATE_KEYS = 10;

export type PantheonSort =
  | "default"
  | "aether"
  | "keys"
  | "soulmates"
  | "name"
  | "series"
  | "claimRank"
  | "likeRank"
  | "avgRank";

/** Parte da consulta do Panteao que vira SQL (`PantheonQuery` do bot satisfaz esta forma). */
export interface PantheonFilter {
  gender?: EntityGender;
  universe?: EntityUniverse;
  keys?: "any" | "none" | "soulmates";
  sort: PantheonSort;
  terms: readonly string[];
  excluded: readonly string[];
}

export function tokensMatch(tokens: readonly string[]): SQL {
  // Cada token precisa aparecer em name_normalized (GIN trigram ajuda para tokens >= 3 letras).
  return and(...tokens.map((tk) => like(entities.nameNormalized, `%${escapeLike(tk)}%`)))!;
}

const f8 = (n: number) => sql.raw(`${n}::float8`);

/**
 * Expressao SQL igual a `pactAetherValue(base_aether, variant, awakening_keys, aether_at_bind)`.
 * Mesma ordem de somas em ponto flutuante (somar 0 e exato) e arredondamento `floor(x + 0.5)`
 * (= Math.round para positivos), entao ordenar/somar no SQL concorda com o valor exibido.
 * Exige as tabelas `pacts` e `entities` no FROM.
 */
export function pactValueSql(): SQL<number> {
  const variantCase = sql`CASE ${pacts.variant} ${sql.join(
    (Object.entries(VARIANT_MULTIPLIER) as Array<[CardVariant, number]>).map(
      ([variant, multiplier]) => sql`WHEN ${sql.raw(`'${variant}'`)} THEN ${f8(multiplier)}`
    ),
    sql` `
  )} ELSE 1::float8 END`;
  const steps = AWAKENING_BONUS_AT.map(
    (at) =>
      sql`CASE WHEN ${pacts.awakeningKeys} >= ${sql.raw(String(at))} THEN ${f8(AWAKENING_BONUS_STEP)} ELSE 0::float8 END`
  );
  const after10 = sql`CASE WHEN ${pacts.awakeningKeys} >= 11 THEN (${pacts.awakeningKeys} - 10)::float8 * ${f8(AWAKENING_BONUS_AFTER_10)} ELSE 0::float8 END`;
  const base = sql`COALESCE(NULLIF(${entities.baseAether}, 0), 150)::float8`;
  const multiplier = sql`(${variantCase} + ${sql.join(steps, sql` + `)} + ${after10})`;
  return sql<number>`GREATEST(floor(${base} * ${multiplier} + 0.5::float8)::bigint, ${pacts.aetherAtBind}::bigint)`.mapWith(
    Number
  );
}

/** Condicao de um termo livre: nome da entidade, titulo da serie ou nome da franquia. */
export function termCondition(term: string): SQL {
  const tokens = nameTokens(term);
  const needle = `%${escapeLike(term.trim())}%`;
  // coalesce: series/franquia vem de LEFT JOIN; NULL aqui faria `NOT (...)` excluir tudo.
  const parts: SQL[] = [
    sql`coalesce(${series.title} ILIKE ${needle}, false)`,
    sql`coalesce(${franchises.name} ILIKE ${needle}, false)`,
  ];
  if (tokens.length > 0) parts.push(tokensMatch(tokens));
  return or(...parts)!;
}

export function pantheonConditions(guildId: string, userId: string, q: PantheonFilter): SQL {
  const conds: Array<SQL | undefined> = [eq(pacts.guildId, guildId), eq(pacts.userId, userId)];
  if (q.gender) conds.push(eq(entities.gender, q.gender));
  if (q.universe) conds.push(eq(entities.universe, q.universe));
  if (q.keys === "any") conds.push(sql`${pacts.awakeningKeys} > 0`);
  else if (q.keys === "none") conds.push(sql`${pacts.awakeningKeys} = 0`);
  else if (q.keys === "soulmates") {
    conds.push(sql`${pacts.awakeningKeys} >= ${sql.raw(String(SOULMATE_KEYS))}`);
  }
  if (q.terms.length > 0) conds.push(or(...q.terms.map(termCondition)));
  for (const term of q.excluded) conds.push(not(termCondition(term)));
  return and(...conds)!;
}

export function pantheonOrder(sort: PantheonSort, value: SQL<number>, seriesName: SQL): SQL[] {
  const byName = sql`lower(${entities.name}) ASC`;
  const tail = [byName, asc(pacts.id)];
  switch (sort) {
    case "aether":
      return [desc(value), ...tail];
    case "keys":
      return [desc(pacts.awakeningKeys), desc(value), ...tail];
    case "soulmates":
      return [
        sql`(${pacts.awakeningKeys} >= ${sql.raw(String(SOULMATE_KEYS))}) DESC`,
        desc(pacts.awakeningKeys),
        desc(value),
        ...tail,
      ];
    case "name":
      return tail;
    case "series":
      return [sql`${seriesName} ASC NULLS LAST`, ...tail];
    case "claimRank":
      return [sql`${entities.claimRank} ASC NULLS LAST`, ...tail];
    case "likeRank":
      return [sql`${entities.likeRank} ASC NULLS LAST`, ...tail];
    case "avgRank":
      return [
        sql`(coalesce(${entities.claimRank}, ${entities.likeRank}) + coalesce(${entities.likeRank}, ${entities.claimRank})) / 2.0 ASC NULLS LAST`,
        ...tail,
      ];
    default:
      return [asc(pacts.sortOrder), asc(pacts.boundAt), asc(pacts.id)];
  }
}