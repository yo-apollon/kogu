import { sql } from "drizzle-orm";
import type { EntityEdition, EntityTier } from "../../config/gacha.js";
import { publishEvent } from "../../infra/redis/pubsub.js";
import type { DbExecutor } from "../executor.js";
import {
  isNicheFamily,
  parseThresholds,
  PRESTIGE_SOURCES,
  type PrestigeSource,
} from "../prestige.js";
import { primarySourceOf, REAL_SOURCES } from "../normalize.js";
import { scoreCatalog, type ScoringInput, type ScoringOutput } from "../scoring.js";
import { newCounters } from "../upsert.js";
import type { JobDef } from "./context.js";

const CHUNK = 1000;

type Row = Record<string, unknown>;

/** Carrega as entidades ACTIVE com fontes e favoritos por fonte. */
export async function loadScoringInputs(db: DbExecutor): Promise<ScoringInput[]> {
  const base = (await db.execute(sql`
    SELECT e.id::int AS id, e.stats_seed AS seed, e.source_favorites AS fav,
           e.edition AS edition, e.parent_id::int AS parent_id,
           e.prestige AS prestige, e.prestige_source AS prestige_source, e.tier_floor AS tier_floor,
           n.key AS niche_key, n.family AS niche_family, n.profile AS niche_profile,
           ps.series_id::int AS series_id, ps.role AS series_role,
           COALESCE(array_agg(DISTINCT x.source::text) FILTER (WHERE x.source IS NOT NULL), '{}') AS sources
    FROM entities e
    LEFT JOIN niches n ON n.id = e.niche_id
    LEFT JOIN LATERAL (
      SELECT es.series_id, es.role FROM entity_series es
      WHERE es.entity_id = e.id ORDER BY es.is_primary DESC, es.series_id ASC LIMIT 1
    ) ps ON true
    LEFT JOIN entity_external_ids x ON x.entity_id = e.id
    WHERE e.status = 'ACTIVE'
    GROUP BY e.id, n.key, n.family, n.profile, ps.series_id, ps.role`)) as unknown as Row[];

  // Favoritos de fontes secundarias: ultimo snapshot (revisao reason='favourites') por fonte.
  const snaps = (await db.execute(sql`
    SELECT DISTINCT ON (entity_id, source) entity_id::int AS id, source::text AS source,
           (diff->>'favourites')::int AS fav
    FROM entity_revisions
    WHERE reason = 'favourites'
    ORDER BY entity_id, source, created_at DESC, id DESC`)) as unknown as Row[];
  const snapBy = new Map<number, Record<string, number>>();
  for (const s of snaps) {
    const m = snapBy.get(s.id as number) ?? {};
    m[s.source as string] = Number(s.fav) || 0;
    snapBy.set(s.id as number, m);
  }

  return base.map((r) => {
    const all = (r.sources as string[]) ?? [];
    const primary = primarySourceOf(all);
    const favorites: Record<string, number> = { [primary]: Number(r.fav) || 0 };
    for (const [src, v] of Object.entries(snapBy.get(r.id as number) ?? {})) {
      if (src !== primary) favorites[src] = v;
    }
    return {
      id: r.id as number,
      statsSeed: Number(r.seed),
      sources: all.filter((s) => (REAL_SOURCES as readonly string[]).includes(s)),
      favorites,
      edition: (r.edition as EntityEdition | null) ?? null,
      parentId: r.parent_id === null || r.parent_id === undefined ? null : Number(r.parent_id),
      niche:
        typeof r.niche_key === "string" && isNicheFamily(r.niche_family)
          ? {
              key: r.niche_key,
              family: r.niche_family,
              thresholds:
                parseThresholds((r.niche_profile as { thresholds?: unknown } | null)?.thresholds) ?? undefined,
            }
          : null,
      prestige: r.prestige === null || r.prestige === undefined ? null : Number(r.prestige),
      prestigeSource: (PRESTIGE_SOURCES as readonly string[]).includes(r.prestige_source as string)
        ? (r.prestige_source as PrestigeSource)
        : null,
      seriesId: r.series_id === null || r.series_id === undefined ? null : Number(r.series_id),
      seriesRole: (r.series_role as string | null) ?? null,
      tierFloor: (r.tier_floor as EntityTier | null) ?? null,
    };
  });
}

/** Grava os resultados (ranks unicos incluidos) numa transacao so. */
export async function applyScores(db: DbExecutor, scores: readonly ScoringOutput[]): Promise<void> {
  await db.transaction(async (tx) => {
    // Quem deixou de ser ACTIVE perde o rank na mesma transacao (constraint deferida).
    await tx.execute(sql`
      UPDATE entities SET popularity_rank = NULL, like_rank = NULL, claim_rank = NULL
      WHERE status <> 'ACTIVE' AND (popularity_rank IS NOT NULL OR like_rank IS NOT NULL OR claim_rank IS NOT NULL)`);

    for (let i = 0; i < scores.length; i += CHUNK) {
      const values = scores.slice(i, i + CHUNK).map(
        (s) =>
          sql`(${s.id}::bigint, ${s.popularityScore}::real, ${s.popularityRank}::int, ${s.tier}::entity_tier,
               ${s.baseAether}::int, ${s.rollWeight}::real, ${s.baseAtk}::int, ${s.baseDef}::int,
               ${s.baseSpd}::int, ${s.baseHp}::int, ${s.prestige}::real, ${s.prestigeSource}::text)`
      );
      await tx.execute(sql`
        UPDATE entities AS e SET
          popularity_score = v.score, popularity_rank = v.rank, tier = v.tier,
          base_aether = v.aether, roll_weight = v.weight,
          base_atk = v.atk, base_def = v.def, base_spd = v.spd, base_hp = v.hp,
          prestige = COALESCE(v.prestige, e.prestige),
          prestige_source = CASE WHEN v.prestige IS NULL THEN e.prestige_source ELSE v.prestige_source END,
          updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, score, rank, tier, aether, weight, atk, def, spd, hp, prestige, prestige_source)
        WHERE e.id = v.id`);
    }

    // Prestigio computado de quem perdeu o nicho nao vale mais.
    await tx.execute(sql`
      UPDATE entities SET prestige = NULL, prestige_source = NULL
      WHERE niche_id IS NULL AND prestige_source = 'COMPUTED'`);

    await tx.execute(sql`
      UPDATE entities e SET like_rank = r.rk
      FROM (SELECT id, row_number() OVER (ORDER BY likes_count DESC, popularity_rank ASC NULLS LAST, id) AS rk
            FROM entities WHERE status = 'ACTIVE') r
      WHERE e.id = r.id`);
    await tx.execute(sql`
      UPDATE entities e SET claim_rank = r.rk
      FROM (SELECT id, row_number() OVER (ORDER BY claims_count DESC, popularity_rank ASC NULLS LAST, id) AS rk
            FROM entities WHERE status = 'ACTIVE') r
      WHERE e.id = r.id`);
  });
}

/** Carrega, pontua e grava o catalogo inteiro (sem evento). Usado pelo job e por scripts. */
export async function rerankCatalog(db: DbExecutor): Promise<ScoringOutput[]> {
  const scores = scoreCatalog(await loadScoringInputs(db));
  await applyScores(db, scores);
  return scores;
}

/** Scoring + tiers + roll_weight + ranks unicos; publica `catalog:updated`. */
export const catalogRerank: JobDef = {
  name: "catalog.rerank",
  queue: "maintenance",
  source: "MANUAL",
  schedule: { pattern: "0 4 * * *" },
  async run(ctx) {
    const scores = await rerankCatalog(ctx.db);
    await publishEvent(ctx.kv, "catalog:updated", { source: "rerank", at: Date.now() });

    const tiers: Record<string, number> = {};
    for (const s of scores) tiers[s.tier] = (tiers[s.tier] ?? 0) + 1;
    return { counters: { ...newCounters(), seen: scores.length, updated: scores.length }, meta: { tiers } };
  },
};
