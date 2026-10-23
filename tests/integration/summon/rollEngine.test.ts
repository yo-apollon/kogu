import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedEntity,
  seedFranchise,
  seedGuild,
  seedMember,
  seedSeries,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

let t: TestDb;
type Engine = typeof import("../../../src/modules/summon/rollEngine.js");
type PoolMod = typeof import("../../../src/modules/summon/pool.js");
let engine: Engine;
let poolMod: PoolMod;
let variants: typeof import("../../../src/modules/summon/variants.js");

beforeAll(async () => {
  t = await setupTestDb();
  engine = await import("../../../src/modules/summon/rollEngine.js");
  poolMod = await import("../../../src/modules/summon/pool.js");
  variants = await import("../../../src/modules/summon/variants.js");
}, 120_000);
afterAll(async () => {
  await poolMod?.stopPoolWatcher();
  await t?.stop();
}, 60_000);

/** Cada teste usa universo/tipo proprio via filtro de series para isolar; aqui isolamos por guild + ids. */
describe("rollEntity", () => {
  it("nunca devolve entidade fora de ACTIVE, nem genero UNKNOWN, nem pool defasado", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const okIds = [
      await seedEntity(t.sql, "Act A", { universe: "CINEMA" }),
      await seedEntity(t.sql, "Act B", { universe: "CINEMA" }),
      await seedEntity(t.sql, "Act C", { universe: "CINEMA" }),
    ];
    const bad = [
      await seedEntity(t.sql, "Pend", { universe: "CINEMA", status: "PENDING_REVIEW" }),
      await seedEntity(t.sql, "Quar", { universe: "CINEMA", status: "QUARANTINED" }),
      await seedEntity(t.sql, "Dis", { universe: "CINEMA", status: "DISABLED" }),
      await seedEntity(t.sql, "Unk", { universe: "CINEMA", gender: "UNKNOWN" }),
    ];
    await poolMod.reloadPool();
    // defasagem: C sai do ar depois do carregamento do pool
    await t.sql`UPDATE entities SET status = 'QUARANTINED' WHERE id = ${okIds[2]}`;
    const rng = variants.createSeededRng(7);
    for (let i = 0; i < 80; i++) {
      const r = await engine.rollEntity({ guildId: g, userId: u, filter: { universe: "CINEMA" }, rng });
      expect(r).not.toBeNull();
      expect(okIds.slice(0, 2)).toContain(r!.id);
      expect(bad).not.toContain(r!.id);
    }
    await t.sql`UPDATE entities SET status = 'ACTIVE' WHERE id = ${okIds[2]}`;
    await poolMod.reloadPool();
  });

  it("anti-repeticao: 8 rolls seguidos em 8 entidades sao todos distintos; depois repete", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    for (let i = 0; i < 8; i++) await seedEntity(t.sql, `Rec ${i}`, { universe: "GAME" });
    await poolMod.reloadPool();
    const rng = variants.createSeededRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const r = await engine.rollEntity({ guildId: g, userId: u, filter: { universe: "GAME" }, rng });
      seen.add(r!.id);
    }
    expect(seen.size).toBe(8);
    expect(await engine.rollEntity({ guildId: g, userId: u, filter: { universe: "GAME" }, rng })).not.toBeNull();
    const kv = await (await import("../../../src/infra/redis/client.js")).getKV();
    expect((await kv.lrange(engine.recentKey(g), 0, -1)).length).toBeLessThanOrEqual(50);
  });

  it("series e franquias desativadas (usuario e servidor) sao rejeitadas; outros usuarios nao", async () => {
    const g = uid("g");
    const [u1, u2] = [uid("u"), uid("u")];
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u1);
    await seedMember(t.sql, g, u2);
    const f = await seedFranchise(t.sql, "Fr");
    const sBlocked = await seedSeries(t.sql, "Blocked");
    const sFr = await seedSeries(t.sql, "InFranchise", f);
    const sSrv = await seedSeries(t.sql, "ServerBlocked");
    const sOk = await seedSeries(t.sql, "Fine");
    const eBlocked = await seedEntity(t.sql, "EB", { universe: "ANIME", type: "COMPANION", seriesId: sBlocked });
    const eFr = await seedEntity(t.sql, "EF", { universe: "ANIME", type: "COMPANION", seriesId: sFr });
    const eSrv = await seedEntity(t.sql, "ES", { universe: "ANIME", type: "COMPANION", seriesId: sSrv });
    const eOk = await seedEntity(t.sql, "EO", { universe: "ANIME", type: "COMPANION", seriesId: sOk });
    await t.sql`INSERT INTO disabled_series (guild_id, user_id, series_id) VALUES (${g}, ${u1}, ${sBlocked})`;
    await t.sql`INSERT INTO disabled_series (guild_id, user_id, franchise_id) VALUES (${g}, ${u1}, ${f})`;
    await t.sql`INSERT INTO disabled_series (guild_id, user_id, series_id, is_server_wide) VALUES (${g}, ${u1}, ${sSrv}, true)`;
    await poolMod.reloadPool();

    const rng = variants.createSeededRng(3);
    const filter = { type: "COMPANION" as const };
    const got1 = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const r = await engine.rollEntity({ guildId: g, userId: u1, filter, rng });
      got1.add(r!.id);
    }
    expect([...got1]).toEqual([eOk]);

    const got2 = new Set<number>();
    for (let i = 0; i < 80; i++) {
      const r = await engine.rollEntity({ guildId: g, userId: u2, filter, rng });
      got2.add(r!.id);
    }
    expect(got2.has(eSrv)).toBe(false); // vale para o servidor todo
    expect(got2.has(eBlocked) && got2.has(eFr)).toBe(true); // desativadas so do u1

    // cache: nova desativacao so vale apos invalidar
    await t.sql`INSERT INTO disabled_series (guild_id, user_id, series_id) VALUES (${g}, ${u2}, ${sOk})`;
    await engine.invalidateDisabledCache(g, u2);
    const after = new Set<number>();
    for (let i = 0; i < 60; i++) {
      after.add((await engine.rollEntity({ guildId: g, userId: u2, filter, rng }))!.id);
    }
    expect(after.has(eOk)).toBe(false);
  });

  it("adulto so com allowAdult", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedEntity(t.sql, "Safe", { type: "DOMAIN", gender: "ITEM" });
    const adult = await seedEntity(t.sql, "Adult", { type: "DOMAIN", gender: "ITEM", isAdult: true });
    await poolMod.reloadPool();
    const rng = variants.createSeededRng(5);
    const f = { type: "DOMAIN" as const };
    let seenAdult = false;
    for (let i = 0; i < 40; i++) {
      const r = await engine.rollEntity({ guildId: g, userId: u, filter: f, rng, allowAdult: false });
      expect(r!.id).not.toBe(adult);
    }
    for (let i = 0; i < 80; i++) {
      const r = await engine.rollEntity({ guildId: g, userId: u, filter: f, rng, allowAdult: true });
      if (r!.id === adult) seenAdult = true;
    }
    expect(seenAdult).toBe(true);
  });

  it("devolve imagem, serie e dono do pacto apenas deste servidor", async () => {
    const [g1, g2] = [uid("g"), uid("g")];
    const [owner, other] = [uid("u"), uid("u")];
    await seedGuild(t.sql, g1);
    await seedGuild(t.sql, g2);
    await seedMember(t.sql, g1, owner);
    await t.sql`UPDATE users SET username = 'Dona' WHERE id = ${owner}`;
    const s = await seedSeries(t.sql, "Serie Rica");
    const e = await seedEntity(t.sql, "Rica", { universe: "GAME", type: "WEAPON", gender: "ITEM", seriesId: s });
    await t.sql`INSERT INTO pacts (guild_id, user_id, entity_id, variant, awakening_keys) VALUES (${g1}, ${owner}, ${e}, 'HOLO', 3)`;
    await poolMod.reloadPool();
    const f = { universe: "GAME" as const, type: "WEAPON" as const };
    const r1 = await engine.rollEntity({ guildId: g1, userId: other, filter: f });
    expect(r1).toMatchObject({ id: e, seriesTitle: "Serie Rica", imageUrl: `https://x/${e}.png` });
    expect(r1!.pact).toMatchObject({ userId: owner, variant: "HOLO", awakeningKeys: 3, ownerName: "Dona" });
    const r2 = await engine.rollEntity({ guildId: g2, userId: other, filter: f });
    expect(r2!.pact).toBeNull();
  });

  it("filtro sem entidades devolve null", async () => {
    expect(
      await engine.rollEntity({ guildId: uid("g"), userId: uid("u"), filter: { universe: "CINEMA", type: "DOMAIN" } })
    ).toBeNull();
  });
});

describe("fallback SQL e boost", () => {
  const rules = (over: Partial<Parameters<Engine["fallbackPick"]>[0]>) => ({
    filter: {},
    boostEnabled: true,
    allowAdult: false,
    now: Date.now(),
    excludeIds: new Set<number>(),
    disabled: { series: [], franchises: [] },
    ...over,
  });

  it("sorteio ponderado proporcional ao peso (1:3) e respeita exclusoes", async () => {
    const light = await seedEntity(t.sql, "FB Light", { universe: "ANIME", type: "WEAPON", gender: "ITEM", weight: 1 });
    const heavy = await seedEntity(t.sql, "FB Heavy", { universe: "ANIME", type: "WEAPON", gender: "ITEM", weight: 3 });
    const skip = await seedEntity(t.sql, "FB Skip", { universe: "ANIME", type: "WEAPON", gender: "ITEM", weight: 100 });
    const others = await t.sql`SELECT id::int AS id FROM entities WHERE type = 'WEAPON' AND id NOT IN (${light}, ${heavy})`;
    const exclude = new Set<number>([skip, ...others.map((r) => r.id as number)]);
    const n = 1200;
    let h = 0;
    for (let i = 0; i < n; i++) {
      const id = await engine.fallbackPick(rules({ filter: { type: "WEAPON" }, excludeIds: exclude }));
      if (id === heavy) h++;
      else expect(id).toBe(light);
    }
    expect(Math.abs(h / n - 0.75)).toBeLessThan(0.06);
  });

  it("boost de lancamento pesa no fallback e no pool; desligado ignora", async () => {
    const s = await seedSeries(t.sql, "Lancamento");
    const boosted = await seedEntity(t.sql, "BO On", { universe: "ANIME", type: "COMPANION", gender: "ITEM", seriesId: s });
    const plain = await seedEntity(t.sql, "BO Off", { universe: "ANIME", type: "COMPANION", gender: "ITEM", weight: 1 });
    // so as duas deste teste: exclui as outras COMPANION ja criadas por outros testes
    const others = await t.sql`SELECT id::int AS id FROM entities WHERE type = 'COMPANION' AND id NOT IN (${boosted}, ${plain})`;
    const exclude = new Set<number>(others.map((r) => r.id as number));
    await t.sql`INSERT INTO release_windows (series_id, source, starts_at, ends_at, boost)
                VALUES (${s}, 'MANUAL', now() - interval '1 second', now() + interval '1 hour', 5)`;

    const share = async (boostEnabled: boolean) => {
      let b = 0;
      const n = 1000;
      for (let i = 0; i < n; i++) {
        const id = await engine.fallbackPick(rules({ filter: { type: "COMPANION" }, boostEnabled, excludeIds: exclude }));
        if (id === boosted) b++;
      }
      return b / n;
    };
    expect(Math.abs((await share(true)) - 5 / 6)).toBeLessThan(0.06);
    expect(Math.abs((await share(false)) - 0.5)).toBeLessThan(0.07);

    // pool em memoria
    const pool = await poolMod.reloadPool();
    const bucket = pool.buckets.find((x) => x.type === "COMPANION" && x.gender === "ITEM")!;
    expect(bucket.boosted.some((x) => x.weight === 1 && x.boost === 5)).toBe(true);
    const rng = variants.createSeededRng(99);
    let hit = 0;
    const n = 30_000;
    const rejectOthers = (id: number) => exclude.has(id);
    for (let i = 0; i < n; i++) {
      const r = poolMod.pickFromPool(pool, { type: "COMPANION" }, {
        rng, now: Date.now(), boostEnabled: true, maxAttempts: 1000, isRejected: rejectOthers,
      });
      if (r.id === boosted) hit++;
    }
    expect(Math.abs(hit / n - 5 / 6)).toBeLessThan(0.02);
  });
});

describe("pool", () => {
  it("catalog:updated dispara recarga", async () => {
    await poolMod.getPool(); // inicia o watcher
    await new Promise((r) => setTimeout(r, 100));
    const before = (await poolMod.getPool()).size;
    await seedEntity(t.sql, "Novo Catalogo", { universe: "CINEMA", type: "DOMAIN", gender: "ITEM" });
    const { getKV } = await import("../../../src/infra/redis/client.js");
    const { publishEvent } = await import("../../../src/infra/redis/pubsub.js");
    await publishEvent(await getKV(), "catalog:updated", { source: "test", at: Date.now() });
    let size = before;
    for (let i = 0; i < 40 && size === before; i++) {
      await new Promise((r) => setTimeout(r, 50));
      size = (await poolMod.getPool()).size;
    }
    expect(size).toBe(before + 1);
  });
});
