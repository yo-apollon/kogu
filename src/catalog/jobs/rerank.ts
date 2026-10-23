import { sql } from "drizzle-orm";
import { publishEvent } from "../../infra/redis/pubsub.js";
import type { DbExecutor } from "../executor.js";
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
           COALESCE(array_agg(DISTINCT x.source::text) FILTER (WHERE x.source IS NOT NULL), '{}') AS sources
    FROM entities e
    LEFT JOIN entity_external_ids x ON x.entity_id = e.id
    WHERE e.status = 'ACTIVE'
    GROUP BY e.id`)) as unknown as Row[];

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
               ${s.baseSpd}::int, ${s.baseHp}::int)`
      );
      await tx.execute(sql`
        UPDATE entities AS e SET
          popularity_score = v.score, popularity_rank = v.rank, tier = v.tier,
          base_aether = v.aether, roll_weight = v.weight,
          base_atk = v.atk, base_def = v.def, base_spd = v.spd, base_hp = v.hp,
          updated_at = now()
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, score, rank, tier, aether, weight, atk, def, spd, hp)
        WHERE e.id = v.id`);
    }

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

/** Scoring + tiers + roll_weight + ranks unicos; publica `catalog:updated`. */
export const catalogRerank: JobDef = {
  name: "catalog.rerank",
  queue: "maintenance",
  source: "MANUAL",
  schedule: { pattern: "0 4 * * *" },
  async run(ctx) {
    const inputs = await loadScoringInputs(ctx.db);
    const scores = scoreCatalog(inputs);
    await applyScores(ctx.db, scores);
    await publishEvent(ctx.kv, "catalog:updated", { source: "rerank", at: Date.now() });

    const tiers: Record<string, number> = {};
    for (const s of scores) tiers[s.tier] = (tiers[s.tier] ?? 0) + 1;
    return { counters: { ...newCounters(), seen: scores.length, updated: scores.length }, meta: { tiers } };
  },
};
