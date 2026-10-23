import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/infra/db/client.js", () => ({ db: {}, sql: {} }));
vi.mock("../../../src/lib/logger.js", () => {
  const noop = () => undefined;
  const stub = { warn: noop, error: noop, info: noop, debug: noop };
  return { logger: stub, childLogger: () => stub };
});

import { currentWindow, nextWindowStart } from "../../../src/lib/time.js";
import {
  buildPool,
  pickFromPool,
  releaseBoost,
  type PoolRow,
} from "../../../src/modules/summon/pool.js";
import { buildRejector } from "../../../src/modules/summon/rollEngine.js";
import { usedInWindow } from "../../../src/modules/summon/service.js";
import { createSeededRng } from "../../../src/modules/summon/variants.js";

const row = (id: number, weight: number, extra: Partial<PoolRow> = {}): PoolRow => ({
  id,
  universe: "ANIME",
  gender: "FEMALE",
  type: "CHARACTER",
  seriesId: null,
  franchiseId: null,
  adult: false,
  weight,
  window: null,
  ...extra,
});

function draw(
  rows: PoolRow[],
  n: number,
  opts: Partial<Parameters<typeof pickFromPool>[2]> = {},
  filter: Parameters<typeof pickFromPool>[1] = {}
) {
  const pool = buildPool(rows);
  const rng = createSeededRng(20260101);
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const { id } = pickFromPool(pool, filter, { rng, now: 0, boostEnabled: true, ...opts });
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function expectProportional(counts: Map<number, number>, weights: Map<number, number>, n: number) {
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  let chi = 0;
  for (const [id, w] of weights) {
    const exp = (w / total) * n;
    const obs = counts.get(id) ?? 0;
    expect(Math.abs(obs - exp) / exp, `id ${id}`).toBeLessThan(0.05);
    chi += (obs - exp) ** 2 / exp;
  }
  // df <= 29; limiar p=0.001 ~ 58
  expect(chi).toBeLessThan(58);
}

describe("sorteio ponderado", () => {
  it("qui-quadrado: frequencias dentro de 5% dos pesos (varios buckets)", () => {
    const rows: PoolRow[] = [];
    const weights = new Map<number, number>();
    for (let i = 1; i <= 20; i++) {
      const w = 0.12 + (i % 5) * 0.22;
      weights.set(i, w);
      rows.push(row(i, w, { gender: i % 2 ? "FEMALE" : "MALE", universe: i % 3 ? "ANIME" : "GAME" }));
    }
    const n = 400_000;
    expectProportional(draw(rows, n), weights, n);
  });

  it("filtros de genero, universo e tipo", () => {
    const rows = [
      row(1, 1),
      row(2, 1, { gender: "MALE" }),
      row(3, 1, { universe: "GAME" }),
      row(4, 1, { type: "WEAPON", gender: "ITEM" }),
    ];
    expect([...draw(rows, 500, {}, { gender: "FEMALE" }).keys()].sort()).toEqual([1, 3, 4].filter((x) => x !== 4));
    expect([...draw(rows, 500, {}, { gender: "MALE" }).keys()]).toEqual([2]);
    expect([...draw(rows, 500, {}, { universe: "GAME" }).keys()]).toEqual([3]);
    expect([...draw(rows, 500, {}, { type: "WEAPON" }).keys()]).toEqual([4]);
    expect([...draw(rows, 800, {}, { gender: "BOTH" }).keys()].sort()).toEqual([1, 2, 3, 4]);
  });

  it("ignora pesos invalidos e pool vazio devolve null", () => {
    const pool = buildPool([row(1, 0), row(2, NaN), row(3, -1)]);
    expect(pool.size).toBe(0);
    expect(pickFromPool(pool, {}, { rng: Math.random, now: 0, boostEnabled: true }).id).toBeNull();
  });
});

describe("rejeicao", () => {
  const rows = [row(1, 1, { seriesId: 10 }), row(2, 2, { franchiseId: 20 }), row(3, 3), row(4, 4)];

  it("nunca devolve serie ou franquia desativada e mantem proporcao do resto", () => {
    const isRejected = buildRejector({
      recent: new Set(),
      disabledSeries: new Set([10]),
      disabledFranchises: new Set([20]),
      allowAdult: false,
    });
    const n = 70_000;
    const counts = draw(rows, n, { isRejected });
    expect(counts.has(1)).toBe(false);
    expect(counts.has(2)).toBe(false);
    expectProportional(counts, new Map([[3, 3], [4, 4]]), n);
  });

  it("nunca devolve recentes", () => {
    const isRejected = buildRejector({
      recent: new Set([3, 4]),
      disabledSeries: new Set(),
      disabledFranchises: new Set(),
      allowAdult: false,
    });
    const counts = draw(rows, 5000, { isRejected });
    expect(counts.has(3) || counts.has(4)).toBe(false);
  });

  it("esgota as tentativas e devolve null para o fallback", () => {
    const r = pickFromPool(buildPool(rows), {}, {
      rng: createSeededRng(1),
      now: 0,
      boostEnabled: true,
      maxAttempts: 7,
      isRejected: () => true,
    });
    expect(r).toEqual({ id: null, attempts: 7 });
  });

  it("adulto so com permissao", () => {
    const base = { recent: new Set<number>(), disabledSeries: new Set<number>(), disabledFranchises: new Set<number>() };
    expect(buildRejector({ ...base, allowAdult: false })(1, 0, 0, true)).toBe(true);
    expect(buildRejector({ ...base, allowAdult: true })(1, 0, 0, true)).toBe(false);
  });
});

describe("boost de lancamento", () => {
  const win = { boost: 3, startsAt: 0, endsAt: 1000 };

  it("decai linearmente ate 1", () => {
    expect(releaseBoost(win, 0)).toBe(3);
    expect(releaseBoost(win, 250)).toBeCloseTo(2.5);
    expect(releaseBoost(win, 500)).toBeCloseTo(2);
    expect(releaseBoost(win, 999)).toBeCloseTo(1.002);
    expect(releaseBoost(win, 1000)).toBe(1);
    expect(releaseBoost(win, 5000)).toBe(1);
    expect(releaseBoost(win, -1)).toBe(1);
  });

  it("aplica w x boost no sorteio e respeita o flag da guild", () => {
    const rows = [row(1, 1, { window: win }), row(2, 1), row(3, 2)];
    const n = 200_000;
    // now=0: pesos 3, 1, 2
    expectProportional(draw(rows, n, { now: 0 }), new Map([[1, 3], [2, 1], [3, 2]]), n);
    // now=500: pesos 2, 1, 2
    expectProportional(draw(rows, n, { now: 500 }), new Map([[1, 2], [2, 1], [3, 2]]), n);
    // desligado ou apos o fim: pesos base
    expectProportional(draw(rows, n, { now: 0, boostEnabled: false }), new Map([[1, 1], [2, 1], [3, 2]]), n);
    expectProportional(draw(rows, n, { now: 2000 }), new Map([[1, 1], [2, 1], [3, 2]]), n);
  });
});

describe("matematica de janela", () => {
  const T = Date.UTC(2026, 0, 1, 10, 25, 0);

  it("virada exata no limite da janela", () => {
    const next = nextWindowStart(60, 0, T);
    expect(next).toBe(Date.UTC(2026, 0, 1, 11, 0, 0));
    expect(currentWindow(60, 0, next - 1)).toBe(currentWindow(60, 0, T));
    expect(currentWindow(60, 0, next)).toBe(currentWindow(60, 0, T) + 1);
  });

  it("offset desloca o reset e intervalos diferentes funcionam", () => {
    expect(nextWindowStart(60, 30, T)).toBe(Date.UTC(2026, 0, 1, 10, 30, 0));
    expect(nextWindowStart(180, 0, T)).toBe(Date.UTC(2026, 0, 1, 12, 0, 0));
  });

  it("contador vence quando a janela gravada e anterior", () => {
    const w = currentWindow(60, 0, T);
    expect(usedInWindow(w, 7, w)).toBe(7);
    expect(usedInWindow(w - 1, 7, w)).toBe(0);
    expect(usedInWindow(-1, 0, w)).toBe(0);
    expect(usedInWindow(w + 1, 4, w)).toBe(4);
  });
});
