import { verifyPrimaryImages } from "../images.js";
import { newCounters } from "../upsert.js";
import type { JobDef } from "./context.js";

/** Revalida primarias com last_verified_at > 7d, em lotes de 500. */
export const imagesVerify: JobDef = {
  name: "images.verify",
  queue: "images",
  source: "MANUAL",
  schedule: { every: 60 * 60 * 1000 },
  async run(ctx, input) {
    const r = await verifyPrimaryImages(ctx.db, {
      now: ctx.now(),
      ...(input.limit ? { batchSize: input.limit } : {}),
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      ...(ctx.lookupImpl ? { lookupImpl: ctx.lookupImpl } : {}),
    });
    return {
      counters: { ...newCounters(), seen: r.checked, updated: r.broken, quarantined: r.quarantined },
      meta: { ...r },
    };
  },
};
