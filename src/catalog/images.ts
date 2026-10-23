import { createHash } from "node:crypto";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { entities, entityImages, entityRevisions } from "../infra/db/schema/index.js";
import {
  safeFetchImage,
  SafeFetchError,
  type FetchFn,
  type LookupFn,
} from "../lib/http/safeFetch.js";
import type { DbExecutor } from "./executor.js";
import { openModeration } from "./quarantine.js";

export const VERIFY_BATCH_SIZE = 500;
export const VERIFY_STALE_DAYS = 7;
/** Falhas transitorias seguidas ate marcar BROKEN. */
export const TRANSIENT_FAIL_LIMIT = 3;
const DAY_MS = 86_400_000;

export type ImageCheck = "OK" | "PERMANENT" | "TRANSIENT";

/** 404/410, tipo/tamanho/host invalidos = permanente; timeout, 5xx, 429, rede = transitorio. */
export function classifyImageError(err: unknown): ImageCheck {
  if (!(err instanceof SafeFetchError)) return "TRANSIENT";
  switch (err.code) {
    case "BAD_CONTENT_TYPE":
    case "TOO_LARGE":
    case "BLOCKED_HOST":
    case "BLOCKED_IP":
    case "BAD_SCHEME":
      return "PERMANENT";
    case "HTTP_ERROR":
      return err.status === 404 || err.status === 410 ? "PERMANENT" : "TRANSIENT";
    default:
      return "TRANSIENT";
  }
}

export interface VerifyOptions {
  now?: Date;
  batchSize?: number;
  staleDays?: number;
  concurrency?: number;
  fetchImpl?: FetchFn;
  lookupImpl?: LookupFn;
}

export interface VerifyReport {
  checked: number;
  ok: number;
  broken: number;
  promoted: number;
  quarantined: number;
  transient: number;
  /** Muitas falhas transitorias no lote: provavel problema de rede, nada foi penalizado. */
  suspectedOutage: boolean;
}

interface Target {
  id: number;
  entityId: number;
  url: string;
  failCount: number;
}

/** Marca a primaria como BROKEN, promove a proxima ACTIVE ou poe a entidade em quarentena. */
async function breakImage(
  db: DbExecutor,
  t: Target,
  now: Date
): Promise<"promoted" | "quarantined" | "none"> {
  return db.transaction(async (tx) => {
    await tx
      .update(entityImages)
      .set({
        status: "BROKEN",
        isPrimary: false,
        failCount: t.failCount + 1,
        lastVerifiedAt: now,
      })
      .where(eq(entityImages.id, t.id));

    const next = await tx
      .select({ id: entityImages.id })
      .from(entityImages)
      .where(and(eq(entityImages.entityId, t.entityId), eq(entityImages.status, "ACTIVE")))
      .orderBy(asc(entityImages.createdAt), asc(entityImages.id))
      .limit(1);
    if (next[0]) {
      await tx.update(entityImages).set({ isPrimary: true }).where(eq(entityImages.id, next[0].id));
      return "promoted";
    }

    const cur = await tx
      .select({ status: entities.status })
      .from(entities)
      .where(eq(entities.id, t.entityId));
    const status = cur[0]?.status;
    if (status === "ACTIVE") {
      await tx
        .update(entities)
        .set({ status: "QUARANTINED", updatedAt: now })
        .where(eq(entities.id, t.entityId));
      await openModeration(tx, {
        entityId: t.entityId,
        reason: "NO_IMAGE",
        details: { brokenUrl: t.url },
      });
      await tx.insert(entityRevisions).values({
        entityId: t.entityId,
        source: "MANUAL",
        reason: "images.verify",
        diff: { status: ["ACTIVE", "QUARANTINED"], image: [t.url, null] },
      });
      return "quarantined";
    }
    return "none";
  });
}

/** Revalida em lote as imagens primarias nao verificadas ha mais de `staleDays`. */
export async function verifyPrimaryImages(
  db: DbExecutor,
  opts: VerifyOptions = {}
): Promise<VerifyReport> {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (opts.staleDays ?? VERIFY_STALE_DAYS) * DAY_MS);
  const targets: Target[] = await db
    .select({
      id: entityImages.id,
      entityId: entityImages.entityId,
      url: entityImages.url,
      failCount: entityImages.failCount,
    })
    .from(entityImages)
    .where(
      and(
        eq(entityImages.isPrimary, true),
        eq(entityImages.status, "ACTIVE"),
        or(isNull(entityImages.lastVerifiedAt), lt(entityImages.lastVerifiedAt, staleBefore))
      )
    )
    .orderBy(sql`${entityImages.lastVerifiedAt} ASC NULLS FIRST`, asc(entityImages.id))
    .limit(opts.batchSize ?? VERIFY_BATCH_SIZE);

  const results = new Array<{ check: ImageCheck; hash?: string }>(targets.length);
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= targets.length) return;
        try {
          const img = await safeFetchImage(targets[i].url, {
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
            ...(opts.lookupImpl ? { lookupImpl: opts.lookupImpl } : {}),
          });
          results[i] = {
            check: "OK",
            hash: createHash("sha1").update(img.buffer).digest("hex"),
          };
        } catch (err) {
          results[i] = { check: classifyImageError(err) };
        }
      }
    })
  );

  const report: VerifyReport = {
    checked: targets.length,
    ok: 0,
    broken: 0,
    promoted: 0,
    quarantined: 0,
    transient: 0,
    suspectedOutage: false,
  };
  const transientCount = results.filter((r) => r.check === "TRANSIENT").length;
  report.suspectedOutage = targets.length >= 20 && transientCount / targets.length > 0.5;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const r = results[i];
    if (r.check === "OK") {
      await db
        .update(entityImages)
        .set({ lastVerifiedAt: now, failCount: 0, contentHash: r.hash ?? null })
        .where(eq(entityImages.id, t.id));
      report.ok++;
      continue;
    }
    if (r.check === "TRANSIENT") {
      report.transient++;
      if (report.suspectedOutage) continue;
      if (t.failCount + 1 < TRANSIENT_FAIL_LIMIT) {
        await db
          .update(entityImages)
          .set({ failCount: t.failCount + 1 })
          .where(eq(entityImages.id, t.id));
        continue;
      }
    }
    report.broken++;
    const outcome = await breakImage(db, t, now);
    if (outcome === "promoted") report.promoted++;
    if (outcome === "quarantined") report.quarantined++;
  }
  return report;
}
