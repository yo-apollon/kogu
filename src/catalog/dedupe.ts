import { and, eq, inArray, ne, notExists, or, sql } from "drizzle-orm";
import {
  entities,
  entityExternalIds,
  entityRevisions,
  entitySeries,
} from "../infra/db/schema/index.js";
import type { Entity } from "../infra/db/schema/index.js";
import { trigramSimilarity } from "../lib/text/normalize.js";
import type { DbExecutor } from "./executor.js";
import { nameKey } from "./normalize.js";

/** Trigrama acima deste valor (na mesma franquia) vira DUPLICATE_SUSPECT. */
export const TRIGRAM_DUPLICATE_THRESHOLD = 0.85;

/* ------------------------------------------------------------------ */
/* Comparacao de nomes (pura)                                         */
/* ------------------------------------------------------------------ */

export interface NameCandidate {
  id: number;
  name: string;
  nameNormalized: string;
}

/** Mesmo conjunto de tokens normalizados (ordem e acentos nao importam). */
export function sameNameKey(a: string, b: string): boolean {
  const ka = nameKey(a);
  return ka !== "" && ka === nameKey(b);
}

/** Nomes iguais pela chave ou com trigrama acima do limiar. */
export function isNameDuplicateSuspect(a: string, b: string): boolean {
  return sameNameKey(a, b) || trigramSimilarity(a, b) > TRIGRAM_DUPLICATE_THRESHOLD;
}

/** Candidatos cujo nome e suspeito de ser o mesmo de `name`. */
export function pickDuplicateSuspects(
  name: string,
  candidates: readonly NameCandidate[],
  excludeIds: readonly number[] = []
): NameCandidate[] {
  const skip = new Set(excludeIds);
  return candidates.filter((c) => !skip.has(c.id) && isNameDuplicateSuspect(name, c.name));
}

/* ------------------------------------------------------------------ */
/* Busca                                                              */
/* ------------------------------------------------------------------ */

/**
 * Chave exata (source, external_id). Segue `merged_into_id` caso o id aponte para uma entidade
 * ja mesclada (ids externos sao reapontados no merge, entao isto e so defesa).
 */
export async function findEntityByExternalId(
  db: DbExecutor,
  source: string,
  externalId: string
): Promise<{ id: number; status: Entity["status"] } | null> {
  const rows = await db
    .select({ id: entities.id, status: entities.status, mergedInto: entities.mergedIntoId })
    .from(entityExternalIds)
    .innerJoin(entities, eq(entities.id, entityExternalIds.entityId))
    .where(
      and(
        eq(entityExternalIds.source, source as never),
        eq(entityExternalIds.externalId, externalId)
      )
    )
    .limit(1);
  let row = rows[0];
  for (let hops = 0; row && row.status === "MERGED" && row.mergedInto !== null && hops < 5; hops++) {
    const next = await db
      .select({ id: entities.id, status: entities.status, mergedInto: entities.mergedIntoId })
      .from(entities)
      .where(eq(entities.id, row.mergedInto))
      .limit(1);
    row = next[0];
  }
  return row ? { id: row.id, status: row.status } : null;
}

export interface CrossSourceMatch {
  /** Entidade que e a mesma de `p`, quando ha exatamente uma. */
  entityId: number | null;
  /** Varias com o mesmo nome na mesma serie: ambiguo, nao funde sozinho. */
  ambiguous: NameCandidate[];
}

/**
 * Casamento entre fontes: mesmo nome normalizado (tokens ordenados) ou mesmo nome nativo E
 * vinculo com a mesma serie (series_external_ids/crossIds levam as duas fontes ao mesmo series.id).
 * Ignora entidades que ja tem id externo da mesma fonte: outro personagem homonimo.
 */
export async function findCrossSourceMatch(
  db: DbExecutor,
  p: { source: string; nameNormalized: string; nameNative?: string | null; seriesIds: readonly number[] }
): Promise<CrossSourceMatch> {
  if (p.seriesIds.length === 0 || p.nameNormalized === "") return { entityId: null, ambiguous: [] };

  const rows = await db
    .select({ id: entities.id, name: entities.name, nameNormalized: entities.nameNormalized })
    .from(entities)
    .innerJoin(entitySeries, eq(entitySeries.entityId, entities.id))
    .where(
      and(
        inArray(entitySeries.seriesId, [...p.seriesIds]),
        ne(entities.status, "MERGED"),
        or(
          eq(entities.nameNormalized, p.nameNormalized),
          p.nameNative ? eq(entities.nameNative, p.nameNative) : undefined
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(entityExternalIds)
            .where(
              and(
                eq(entityExternalIds.entityId, entities.id),
                eq(entityExternalIds.source, p.source as never)
              )
            )
        )
      )
    );

  const unique = new Map<number, NameCandidate>();
  for (const r of rows) unique.set(r.id, r);
  const list = [...unique.values()];
  if (list.length === 1) return { entityId: list[0].id, ambiguous: [] };
  return { entityId: null, ambiguous: list };
}

const FRANCHISE_SCAN_LIMIT = 3000;

/**
 * Entidades da mesma franquia com nome suspeito de ser o mesmo (chave igual ou trigrama > 0.85).
 * Sem franquia nao ha comparacao (evita falsos positivos entre obras sem relacao).
 */
export async function findSimilarInFranchise(
  db: DbExecutor,
  p: { franchiseId: number | null; name: string; excludeIds?: readonly number[] }
): Promise<NameCandidate[]> {
  if (p.franchiseId === null) return [];
  const rows = await db
    .select({ id: entities.id, name: entities.name, nameNormalized: entities.nameNormalized })
    .from(entities)
    .where(and(eq(entities.franchiseId, p.franchiseId), ne(entities.status, "MERGED")))
    .limit(FRANCHISE_SCAN_LIMIT);
  return pickDuplicateSuspects(p.name, rows, p.excludeIds ?? []);
}

/* ------------------------------------------------------------------ */
/* Merge                                                              */
/* ------------------------------------------------------------------ */

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeError";
  }
}

export interface MergeOptions {
  /** ID Discord do moderador; nulo = automatico. */
  changedBy?: string | null;
  reason?: string;
  now?: Date;
  syncRunId?: number | null;
}

export interface MergeResult {
  winnerId: number;
  loserId: number;
  pactsMoved: number;
  /** Pares de pactos na mesma guild: o mais antigo fica. */
  pactConflicts: number;
  /** Eter devolvido (soma de aether_at_bind dos pactos descartados). */
  aetherRefunded: number;
  wishesMoved: number;
  likesMoved: number;
  imagesMoved: number;
  externalIdsMoved: number;
}

type Row = Record<string, unknown>;

function affected(res: unknown): number {
  const r = res as { count?: number; length: number };
  return typeof r.count === "number" ? r.count : r.length;
}

/**
 * Funde `loserId` em `winnerId` numa transacao: o perdedor vira MERGED (merged_into_id) e tudo
 * que apontava para ele passa para o vencedor.
 *
 * - pacts: reapontados (FK restrict impede apagar a entidade). Conflito na mesma guild (as duas
 *   entidades tem pacto la): fica o pacto mais antigo (bound_at, id); o dono do descartado recebe
 *   `aether_at_bind` em guild_members.aether_balance.
 * - wishes / entity_likes: reapontados; duplicados descartados (starwish prevalece).
 * - external ids, series, imagens (a primaria do vencedor e preservada), ofertas e log de rolls.
 * - pendencias de moderacao que citam o perdedor sao fechadas como resolvidas pelo merge.
 */
export async function mergeEntities(
  db: DbExecutor,
  winnerId: number,
  loserId: number,
  opts: MergeOptions = {}
): Promise<MergeResult> {
  if (winnerId === loserId) throw new MergeError("winner e loser sao a mesma entidade");
  const now = opts.now ?? new Date();
  const reviewer = opts.changedBy ?? "system";

  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: entities.id, status: entities.status })
      .from(entities)
      .where(inArray(entities.id, [winnerId, loserId]))
      .orderBy(entities.id)
      .for("update");
    const winner = locked.find((r) => r.id === winnerId);
    const loser = locked.find((r) => r.id === loserId);
    if (!winner || !loser) throw new MergeError("entidade inexistente");
    if (winner.status === "MERGED") throw new MergeError("o vencedor ja foi mesclado em outra entidade");
    if (loser.status === "MERGED") throw new MergeError("o perdedor ja foi mesclado");

    const result: MergeResult = {
      winnerId,
      loserId,
      pactsMoved: 0,
      pactConflicts: 0,
      aetherRefunded: 0,
      wishesMoved: 0,
      likesMoved: 0,
      imagesMoved: 0,
      externalIdsMoved: 0,
    };

    // --- pactos ---
    const conflicts = (await tx.execute(sql`
      SELECT w.id::int AS w_id, l.id::int AS l_id, w.guild_id AS guild_id,
             w.user_id AS w_user, l.user_id AS l_user,
             w.aether_at_bind AS w_aether, l.aether_at_bind AS l_aether,
             ((l.bound_at, l.id) < (w.bound_at, w.id)) AS loser_older
      FROM pacts w
      JOIN pacts l ON l.guild_id = w.guild_id AND l.entity_id = ${loserId}
      WHERE w.entity_id = ${winnerId}`)) as unknown as Row[];
    for (const c of conflicts) {
      const loserOlder = c.loser_older === true;
      const dropId = (loserOlder ? c.w_id : c.l_id) as number;
      const dropUser = (loserOlder ? c.w_user : c.l_user) as string;
      const refund = Number(loserOlder ? c.w_aether : c.l_aether) || 0;
      await tx.execute(sql`DELETE FROM pacts WHERE id = ${dropId}`);
      if (refund > 0) {
        await tx.execute(sql`
          UPDATE guild_members SET aether_balance = aether_balance + ${refund}, updated_at = now()
          WHERE guild_id = ${c.guild_id as string} AND user_id = ${dropUser}`);
      }
      result.pactConflicts++;
      result.aetherRefunded += refund;
    }
    result.pactsMoved = affected(
      await tx.execute(sql`UPDATE pacts SET entity_id = ${winnerId} WHERE entity_id = ${loserId}`)
    );

    // --- wishes ---
    await tx.execute(sql`
      UPDATE wishes w SET is_starwish = true
      FROM wishes l
      WHERE w.entity_id = ${winnerId} AND l.entity_id = ${loserId}
        AND l.guild_id = w.guild_id AND l.user_id = w.user_id
        AND l.is_starwish AND NOT w.is_starwish`);
    result.wishesMoved = affected(
      await tx.execute(sql`
        UPDATE wishes SET entity_id = ${winnerId}
        WHERE entity_id = ${loserId}
          AND NOT EXISTS (
            SELECT 1 FROM wishes x
            WHERE x.entity_id = ${winnerId} AND x.guild_id = wishes.guild_id AND x.user_id = wishes.user_id)`)
    );
    await tx.execute(sql`DELETE FROM wishes WHERE entity_id = ${loserId}`);

    // --- likes ---
    result.likesMoved = affected(
      await tx.execute(sql`
        UPDATE entity_likes SET entity_id = ${winnerId}
        WHERE entity_id = ${loserId}
          AND NOT EXISTS (
            SELECT 1 FROM entity_likes x
            WHERE x.entity_id = ${winnerId} AND x.user_id = entity_likes.user_id)`)
    );
    await tx.execute(sql`DELETE FROM entity_likes WHERE entity_id = ${loserId}`);

    // --- ofertas e historico ---
    await tx.execute(sql`UPDATE roll_offers SET entity_id = ${winnerId} WHERE entity_id = ${loserId}`);
    await tx.execute(sql`UPDATE roll_log SET entity_id = ${winnerId} WHERE entity_id = ${loserId}`);

    // --- ids externos ---
    result.externalIdsMoved = affected(
      await tx.execute(
        sql`UPDATE entity_external_ids SET entity_id = ${winnerId} WHERE entity_id = ${loserId}`
      )
    );

    // --- series ---
    await tx.execute(sql`
      INSERT INTO entity_series (entity_id, series_id, role, is_primary)
      SELECT ${winnerId}, series_id, role, false FROM entity_series WHERE entity_id = ${loserId}
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`DELETE FROM entity_series WHERE entity_id = ${loserId}`);
    await tx.execute(sql`
      UPDATE entity_series SET is_primary = true
      WHERE entity_id = ${winnerId}
        AND series_id = (SELECT min(series_id) FROM entity_series WHERE entity_id = ${winnerId})
        AND NOT EXISTS (SELECT 1 FROM entity_series WHERE entity_id = ${winnerId} AND is_primary)`);

    // --- imagens ---
    const loserPrimary = (await tx.execute(
      sql`SELECT id::int AS id FROM entity_images WHERE entity_id = ${loserId} AND is_primary`
    )) as unknown as Row[];
    await tx.execute(sql`
      DELETE FROM entity_images li USING entity_images wi
      WHERE li.entity_id = ${loserId} AND wi.entity_id = ${winnerId} AND li.url = wi.url`);
    await tx.execute(
      sql`UPDATE entity_images SET is_primary = false WHERE entity_id = ${loserId} AND is_primary`
    );
    result.imagesMoved = affected(
      await tx.execute(sql`UPDATE entity_images SET entity_id = ${winnerId} WHERE entity_id = ${loserId}`)
    );
    const preferred = loserPrimary[0]?.id as number | undefined;
    await tx.execute(sql`
      UPDATE entity_images SET is_primary = true
      WHERE id = (
        SELECT id FROM entity_images
        WHERE entity_id = ${winnerId} AND status = 'ACTIVE'
        ORDER BY (id = ${preferred ?? 0}) DESC, created_at, id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM entity_images WHERE entity_id = ${winnerId} AND is_primary)`);

    // --- campos do vencedor ---
    await tx.execute(sql`
      UPDATE entities w SET
        name_native = COALESCE(w.name_native, l.name_native),
        description = COALESCE(w.description, l.description),
        gender = CASE WHEN w.gender = 'UNKNOWN' THEN l.gender ELSE w.gender END,
        franchise_id = COALESCE(w.franchise_id, l.franchise_id),
        is_adult = w.is_adult OR l.is_adult,
        source_favorites = GREATEST(w.source_favorites, l.source_favorites),
        claims_count = w.claims_count + l.claims_count,
        likes_count = (SELECT count(*)::int FROM entity_likes WHERE entity_id = ${winnerId}),
        updated_at = ${now.toISOString()}::timestamptz
      FROM entities l
      WHERE w.id = ${winnerId} AND l.id = ${loserId}`);

    // --- moderacao ---
    await tx.execute(sql`
      UPDATE moderation_queue
      SET status = 'APPROVED', reviewed_by = ${reviewer}, reviewed_at = ${now.toISOString()}::timestamptz,
          details = details || ${JSON.stringify({ mergedInto: winnerId, mergedFrom: loserId })}::jsonb
      WHERE status = 'PENDING' AND (entity_id = ${loserId} OR other_entity_id = ${loserId})`);

    // --- perdedor ---
    await tx
      .update(entities)
      .set({ mergedIntoId: winnerId })
      .where(and(eq(entities.mergedIntoId, loserId), ne(entities.id, winnerId)));
    await tx
      .update(entities)
      .set({
        status: "MERGED",
        mergedIntoId: winnerId,
        popularityRank: null,
        likeRank: null,
        claimRank: null,
        updatedAt: now,
      })
      .where(eq(entities.id, loserId));

    await tx.insert(entityRevisions).values([
      {
        entityId: winnerId,
        source: "MANUAL",
        changedBy: opts.changedBy ?? null,
        reason: opts.reason ?? "merge",
        diff: { mergedFrom: loserId, ...result },
        syncRunId: opts.syncRunId ?? null,
      },
      {
        entityId: loserId,
        source: "MANUAL",
        changedBy: opts.changedBy ?? null,
        reason: opts.reason ?? "merge",
        diff: { mergedInto: winnerId },
        syncRunId: opts.syncRunId ?? null,
      },
    ]);

    return result;
  });
}
