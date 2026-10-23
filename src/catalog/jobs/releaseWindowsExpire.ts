import { expireReleaseWindows } from "../releaseWindows.js";
import { newCounters } from "../upsert.js";
import type { JobDef } from "./context.js";

export const releaseWindowsExpire: JobDef = {
  name: "releaseWindows.expire",
  queue: "maintenance",
  source: "MANUAL",
  schedule: { every: 60 * 60 * 1000 },
  async run(ctx) {
    const closed = await expireReleaseWindows(ctx.db, ctx.now());
    return { counters: { ...newCounters(), seen: closed, updated: closed }, meta: { closed } };
  },
};
