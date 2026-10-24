// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
/**
 * Builders SQL puros da busca por trigram (pg_trgm) usados pelo bot e pela dashboard. As colunas
 * devem ter indice GIN `gin_trgm_ops`. `key` e o texto ja normalizado e `tokens` os termos (<= 6).
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * `%` (similaridade do texto todo) e `<%` (similaridade com um trecho) cobrem erros de digitacao;
 * os `LIKE`/`ILIKE` por token cobrem digitacao parcial. Os tres usam o indice GIN trigram.
 * `caseInsensitive` usa `ILIKE` (colunas nao normalizadas, ex.: series.title).
 */
export function trigramMatch(
  column: AnyColumn,
  key: string,
  tokens: readonly string[],
  caseInsensitive = false
): SQL {
  const op = caseInsensitive ? sql`ILIKE` : sql`LIKE`;
  const tokenMatches = tokens.map((tok) => sql`${column} ${op} ${`%${tok}%`}`);
  return sql`(${column} % ${key} OR ${key} <% ${column} OR (${sql.join(tokenMatches, sql` AND `)}))`;
}

/** Melhor entre similaridade do texto todo e de um trecho (0..1). */
export function trigramScore(column: AnyColumn, key: string): SQL<number> {
  return sql<number>`GREATEST(similarity(${column}, ${key}), word_similarity(${key}, ${column}))`;
}