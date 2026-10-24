import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  normalized,
  seedEntity,
  seedFranchise,
  seedGuild,
  seedMember,
  seedPact,
  seedSeries,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

let t: TestDb;
type Svc = typeof import("../../../src/modules/collection/service.js");
type Flags = typeof import("../../../src/modules/collection/flags.js");
type Eco = typeof import("../../../src/modules/economy/service.js");
type Variants = typeof import("../../../src/modules/summon/variants.js");
let svc: Svc;
let flags: Flags;
let eco: Eco;
let variants: Variants;

beforeAll(async () => {
  t = await setupTestDb();
  svc = await import("../../../src/modules/collection/service.js");
  flags = await import("../../../src/modules/collection/flags.js");
  eco = await import("../../../src/modules/economy/service.js");
  variants = await import("../../../src/modules/summon/variants.js");
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

const keyOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { key?: string }).key ?? `raw:${(e as Error).message}`;
  }
};

async function newGuild(...users: string[]) {
  const g = uid("g");
  await seedGuild(t.sql, g);
  for (const u of users) await seedMember(t.sql, g, u);
  return g;
}

const queryOf = (invokedAs: string, tokens: string[] = []) =>
  flags.parsePantheonTokens(invokedAs, tokens).query;

describe("pactValueSql", () => {
  it("o valor calculado no SQL e igual a pactAetherValue (grade base x variante x selos)", async () => {
    const u = uid("u");
    const g = await newGuild(u);
    const bases = [0, 1, 5, 37, 100, 333, 777, 1200];
    const keysList = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 25];
    const cases: Array<{ base: number; variant: string; keys: number; bind: number }> = [];
    for (const base of bases) {
      for (const variant of ["STANDARD", "FOIL", "HOLO", "ASTRAL"]) {
        for (const keys of keysList)
          cases.push({ base, variant, keys, bind: keys % 3 === 0 ? 900 : 0 });
      }
    }
    const rows = cases.map((c, i) => ({
      slug: `grid-${g}-${i}`,
      name: `Grid ${i}`,
      name_normalized: normalized(`Grid ${i}`),
      universe: "ANIME",
      base_aether: c.base,
    }));
    const ids = await t.sql`
      INSERT INTO entities ${t.sql(rows, "slug", "name", "name_normalized", "universe", "base_aether")}
      RETURNING id::int AS id, slug`;
    const idBySlug = new Map(ids.map((r) => [r.slug as string, r.id as number]));
    const pactRows = cases.map((c, i) => ({
      guild_id: g,
      user_id: u,
      entity_id: idBySlug.get(`grid-${g}-${i}`)!,
      variant: c.variant,
      awakening_keys: c.keys,
      aether_at_bind: c.bind,
    }));
    await t.sql`INSERT INTO pacts ${t.sql(pactRows, "guild_id", "user_id", "entity_id", "variant", "awakening_keys", "aether_at_bind")}`;

    const page = await svc.listPantheon(g, u, queryOf("pt"), 1, 1000);
    expect(page.total).toBe(cases.length);
    expect(page.rows).toHaveLength(cases.length);

    const byEntity = new Map(page.rows.map((r) => [r.entityId, r]));
    let checked = 0;
    cases.forEach((c, i) => {
      const row = byEntity.get(idBySlug.get(`grid-${g}-${i}`)!)!;
      const expected = variants.pactAetherValue(c.base, c.variant, c.keys, c.bind);
      expect(row.value, `base=${c.base} ${c.variant} keys=${c.keys} bind=${c.bind}`).toBe(expected);
      checked++;
    });
    expect(checked).toBe(cases.length);
    const sum = page.rows.reduce((acc, r) => acc + r.value, 0);
    expect(page.totalAether).toBe(sum);
  }, 60_000);
});

describe("listPantheon", () => {
  async function seed25() {
    const u = uid("u");
    const other = uid("u");
    const g = await newGuild(u, other);
    const alpha = await seedSeries(t.sql, "Alpha Saga");
    const beta = await seedSeries(t.sql, "Beta Chronicles");
    const variantsList = ["STANDARD", "FOIL", "HOLO", "ASTRAL", "STANDARD"];
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const name = `Hero ${String.fromCharCode(65 + i)}`; // Hero A .. Hero Y
      const e = await seedEntity(t.sql, name, {
        gender: i % 2 === 0 ? "FEMALE" : "MALE",
        baseAether: 100 + i * 10,
        seriesId: i < 12 ? alpha : beta,
        claimRank: 100 - i,
        likeRank: i + 1,
      });
      ids.push(e);
      await seedPact(t.sql, g, u, e, {
        variant: variantsList[i % variantsList.length],
        awakeningKeys: i % 6 === 5 ? 10 + i : i % 4 === 0 ? 0 : i % 4,
      });
    }
    // Pacto de outro jogador no mesmo servidor nunca aparece.
    const foreign = await seedEntity(t.sql, "Foreign Hero");
    await seedPact(t.sql, g, other, foreign);
    return { g, u, other, ids, alpha, beta };
  }

  it("pagina de 10 em 10 sem repetir nem perder itens", async () => {
    const { g, u } = await seed25();
    const q = queryOf("pt");
    const p1 = await svc.listPantheon(g, u, q, 1, 10);
    const p2 = await svc.listPantheon(g, u, q, 2, 10);
    const p3 = await svc.listPantheon(g, u, q, 3, 10);
    const p4 = await svc.listPantheon(g, u, q, 4, 10);
    expect([p1.rows.length, p2.rows.length, p3.rows.length, p4.rows.length]).toEqual([
      10, 10, 5, 0,
    ]);
    expect(p1.total).toBe(25);
    const all = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.pactId);
    expect(new Set(all).size).toBe(25);
    // ordem padrao: pactos mais antigos primeiro (bound_at crescente)
    expect(p1.rows[0].name).toBe("Hero A");
    expect(p1.leaderName).toBe("Hero A");
  });

  it("filtra por genero (flags w/h) e por selos (y, y!, y-)", async () => {
    const { g, u } = await seed25();
    const women = await svc.listPantheon(g, u, queryOf("ptw"), 1, 100);
    expect(women.total).toBe(13);
    expect(women.rows.every((r) => r.gender === "FEMALE")).toBe(true);
    const men = await svc.listPantheon(g, u, queryOf("pth"), 1, 100);
    expect(men.total).toBe(12);
    expect(men.rows.every((r) => r.gender === "MALE")).toBe(true);
    // wh nao filtra
    expect((await svc.listPantheon(g, u, queryOf("ptwh"), 1, 100)).total).toBe(25);

    const withKeys = await svc.listPantheon(g, u, queryOf("pty"), 1, 100);
    expect(withKeys.rows.every((r) => r.awakeningKeys > 0)).toBe(true);
    const soul = await svc.listPantheon(g, u, queryOf("pty!"), 1, 100);
    expect(soul.total).toBeGreaterThan(0);
    expect(soul.rows.every((r) => r.awakeningKeys >= 10)).toBe(true);
    const noKeys = await svc.listPantheon(g, u, queryOf("pty-"), 1, 100);
    expect(noKeys.rows.every((r) => r.awakeningKeys === 0)).toBe(true);
    expect(withKeys.total + noKeys.total).toBe(25);
  });

  it("ordena no SQL: Eter (k=), selos (y=), nome (==), serie (a) e ranks (r, l)", async () => {
    const { g, u } = await seed25();
    const all = async (invoked: string) =>
      (await svc.listPantheon(g, u, queryOf(invoked), 1, 100)).rows;

    const byAether = await all("ptk=");
    for (let i = 1; i < byAether.length; i++) {
      expect(byAether[i - 1].value).toBeGreaterThanOrEqual(byAether[i].value);
    }
    const byKeys = await all("pty=");
    for (let i = 1; i < byKeys.length; i++) {
      expect(byKeys[i - 1].awakeningKeys).toBeGreaterThanOrEqual(byKeys[i].awakeningKeys);
    }
    const byName = await all("pt==");
    expect(byName.map((r) => r.name)).toEqual([...byName.map((r) => r.name)].sort());
    const bySeries = await all("pta");
    const titles = bySeries.map((r) => r.seriesTitle);
    expect(titles.slice(0, 12).every((s) => s === "Alpha Saga")).toBe(true);
    expect(titles.slice(12).every((s) => s === "Beta Chronicles")).toBe(true);
    const byClaim = await all("ptr");
    expect(byClaim[0].claimRank).toBe(Math.min(...byClaim.map((r) => r.claimRank!)));
    const byLike = await all("ptl");
    expect(byLike[0].likeRank).toBe(1);
  });

  it("termos incluem/excluem por serie ou nome ($termo, $--termo)", async () => {
    const { g, u } = await seed25();
    const only = await svc.listPantheon(g, u, queryOf("pt", ["$alpha"]), 1, 100);
    expect(only.total).toBe(12);
    expect(only.rows.every((r) => r.seriesTitle === "Alpha Saga")).toBe(true);
    const without = await svc.listPantheon(g, u, queryOf("pt", ["$--alpha"]), 1, 100);
    expect(without.total).toBe(13);
    expect(without.rows.every((r) => r.seriesTitle === "Beta Chronicles")).toBe(true);
    // varios tokens no mesmo termo: todos precisam casar ("hero b" so existe em "Hero B")
    const byName = await svc.listPantheon(g, u, queryOf("pt", ["$hero", "b"]), 1, 100);
    expect(byName.rows.map((r) => r.name)).toEqual(["Hero B"]);
  });

  it("slash: ordenar + genero equivalem as flags", async () => {
    const { g, u } = await seed25();
    const q = flags.queryFromSlash({ sort: "aether", gender: "MALE" });
    const r = await svc.listPantheon(g, u, q, 1, 100);
    expect(r.rows.every((x) => x.gender === "MALE")).toBe(true);
    for (let i = 1; i < r.rows.length; i++)
      expect(r.rows[i - 1].value).toBeGreaterThanOrEqual(r.rows[i].value);
  });

  it("soma o Eter filtrado e usa max(valor atual, aether_at_bind)", async () => {
    const u = uid("u");
    const g = await newGuild(u);
    const e1 = await seedEntity(t.sql, "Low Base", { baseAether: 100 });
    const e2 = await seedEntity(t.sql, "High Base", { baseAether: 100 });
    await seedPact(t.sql, g, u, e1, { aetherAtBind: 900 }); // 900 > 100
    await seedPact(t.sql, g, u, e2, { variant: "FOIL", awakeningKeys: 0 }); // 125
    const r = await svc.listPantheon(g, u, queryOf("ptk="), 1, 10);
    expect(r.rows.map((x) => x.value)).toEqual([900, 125]);
    expect(r.totalAether).toBe(1025);
  });
});

describe("findOwnPact / dissolve", () => {
  it("acha por nome, apelido e pact:<id>; so do proprio jogador", async () => {
    const u = uid("u");
    const v = uid("u");
    const g = await newGuild(u, v);
    const zero = await seedEntity(t.sql, "Zero Two");
    const gojo = await seedEntity(t.sql, "Satoru Gojo");
    const pZero = await seedPact(t.sql, g, u, zero, { alias: "Darling" });
    await seedPact(t.sql, g, u, gojo, { alias2: "Limitless" });
    const other = await seedEntity(t.sql, "Mikasa Ackerman");
    await seedPact(t.sql, g, v, other);

    expect((await svc.findOwnPact(g, u, "zero two"))?.pactId).toBe(pZero);
    expect((await svc.findOwnPact(g, u, "two zero"))?.pactId).toBe(pZero);
    expect((await svc.findOwnPact(g, u, "Zero"))?.pactId).toBe(pZero);
    expect((await svc.findOwnPact(g, u, "darling"))?.pactId).toBe(pZero);
    expect((await svc.findOwnPact(g, u, "limitless"))?.name).toBe("Satoru Gojo");
    expect((await svc.findOwnPact(g, u, `pact:${pZero}`))?.name).toBe("Zero Two");
    expect((await svc.findOwnPact(g, u, "gojo satoru"))?.name).toBe("Satoru Gojo");
    expect(await svc.findOwnPact(g, u, "mikasa")).toBeNull(); // pacto de outro jogador
    expect(await svc.findOwnPact(g, v, `pact:${pZero}`)).toBeNull(); // nem por id
    expect(await svc.findOwnPact(g, u, "   ")).toBeNull();
  });

  it("divorce devolve o Eter (max entre valor atual e aether_at_bind) e remove o pacto", async () => {
    const u = uid("u");
    const g = await newGuild(u);
    const e = await seedEntity(t.sql, "Refund Target", { baseAether: 200 });
    const e2 = await seedEntity(t.sql, "Bind Wins", { baseAether: 100 });
    await seedPact(t.sql, g, u, e, { variant: "HOLO", awakeningKeys: 3 }); // 200 * (1.75+0.1) = 370
    await seedPact(t.sql, g, u, e2, { aetherAtBind: 900 });
    await t.sql`UPDATE guild_members SET aether_balance = 1000 WHERE guild_id = ${g} AND user_id = ${u}`;

    const p1 = (await svc.findOwnPact(g, u, "refund target"))!;
    expect(p1.value).toBe(370);
    const r1 = await svc.dissolveOwnPact(g, u, p1);
    expect(r1.refund).toBe(370);
    expect(r1.balance).toBe(1370);

    const p2 = (await svc.findOwnPact(g, u, "bind wins"))!;
    expect(p2.value).toBe(900);
    const r2 = await svc.dissolveOwnPact(g, u, p2);
    expect(r2.refund).toBe(900);
    expect(await eco.getBalance(g, u)).toBe(2270);

    const [{ n }] = await t.sql`SELECT count(*)::int n FROM pacts WHERE guild_id = ${g}`;
    expect(n).toBe(0);
    // segunda dissolucao: erro que cita o nome
    const err = await svc.dissolveOwnPact(g, u, p1).catch((e) => e);
    expect(err.key).toBe("errors.not_in_pantheon");
    expect(err.params.query).toBe("Refund Target");
  });

  it("dissolve concorrente paga uma vez so", async () => {
    const u = uid("u");
    const g = await newGuild(u);
    const e = await seedEntity(t.sql, "Double Click", { baseAether: 100 });
    await seedPact(t.sql, g, u, e);
    const p = (await svc.findOwnPact(g, u, "double click"))!;
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => keyOf(svc.dissolveOwnPact(g, u, p)))
    );
    expect(rs.filter((r) => r === "ok")).toHaveLength(1);
    expect(await eco.getBalance(g, u)).toBe(100);
  });
});

describe("setLeader ($firstmarry)", () => {
  it("reordena: o escolhido vai para a frente sem mexer na posse; repetir nao muda", async () => {
    const u = uid("u");
    const g = await newGuild(u);
    const names = ["Ann", "Bea", "Cyd"];
    const pacts: number[] = [];
    for (const n of names) pacts.push(await seedPact(t.sql, g, u, await seedEntity(t.sql, n)));
    const order = async () =>
      (await svc.listPantheon(g, u, queryOf("pt"), 1, 10)).rows.map((r) => r.name);

    expect(await order()).toEqual(["Ann", "Bea", "Cyd"]);
    const r1 = await svc.setLeader(g, u, pacts[2]);
    expect(r1.sortOrder).toBe(-1);
    expect(await order()).toEqual(["Cyd", "Ann", "Bea"]);

    // ja e o lider: nada muda
    const again = await svc.setLeader(g, u, pacts[2]);
    expect(again.sortOrder).toBe(-1);

    await svc.setLeader(g, u, pacts[1]);
    expect(await order()).toEqual(["Bea", "Cyd", "Ann"]);
    expect((await svc.listPantheon(g, u, queryOf("pt"), 1, 10)).leaderName).toBe("Bea");

    const [{ n }] =
      await t.sql`SELECT count(*)::int n FROM pacts WHERE guild_id = ${g} AND user_id = ${u}`;
    expect(n).toBe(3);
  });

  it("nao-dono e recusado e nada muda", async () => {
    const u = uid("u");
    const v = uid("u");
    const g = await newGuild(u, v);
    const p = await seedPact(t.sql, g, u, await seedEntity(t.sql, "Mine Only"));
    await seedPact(t.sql, g, u, await seedEntity(t.sql, "Mine Other"));
    expect(await keyOf(svc.setLeader(g, v, p))).toBe("errors.not_in_pantheon");
    const [row] = await t.sql`SELECT sort_order FROM pacts WHERE id = ${p}`;
    expect(row.sort_order).toBe(0);
  });
});

describe("giveEntity ($give)", () => {
  it("transfere o pacto, cria o membro destinatario e limpa personalizacoes do dono antigo", async () => {
    const u = uid("u");
    const dest = uid("u"); // sem guild_members ainda
    const g = await newGuild(u);
    const e = await seedEntity(t.sql, "Gift Me", { baseAether: 150 });
    const p = await seedPact(t.sql, g, u, e, {
      variant: "FOIL",
      awakeningKeys: 4,
      aetherAtBind: 500,
      sortOrder: -3,
      alias: "mine",
      note: "segredo",
    });

    const moved = await svc.giveEntity({
      guildId: g,
      fromUserId: u,
      to: { id: dest, username: "Destinatario" },
      pactId: p,
    });
    expect(moved).toEqual({ pactId: p, entityId: e });

    const [row] = await t.sql`
      SELECT user_id, variant, awakening_keys, aether_at_bind, sort_order, alias, note
      FROM pacts WHERE id = ${p}`;
    expect(row).toMatchObject({
      user_id: dest,
      variant: "FOIL",
      awakening_keys: 4,
      aether_at_bind: 500,
      sort_order: 0,
      alias: null,
      note: null,
    });
    const [member] = await t.sql`
      SELECT aether_balance FROM guild_members WHERE guild_id = ${g} AND user_id = ${dest}`;
    expect(Number(member.aether_balance)).toBe(eco.WELCOME_AETHER);
    const [usr] = await t.sql`SELECT username FROM users WHERE id = ${dest}`;
    expect(usr.username).toBe("Destinatario");

    expect((await svc.listPantheon(g, u, queryOf("pt"), 1, 10)).total).toBe(0);
    const theirs = await svc.listPantheon(g, dest, queryOf("pt"), 1, 10);
    expect(theirs.rows.map((r) => r.name)).toEqual(["Gift Me"]);
  });

  it("nao-dono e recusado: pacto fica com o dono e o destinatario nao e criado", async () => {
    const owner = uid("u");
    const thief = uid("u");
    const ghost = uid("u");
    const g = await newGuild(owner, thief);
    const p = await seedPact(t.sql, g, owner, await seedEntity(t.sql, "Not Yours"));

    const err = await svc
      .giveEntity({
        guildId: g,
        fromUserId: thief,
        to: { id: ghost },
        pactId: p,
        label: "Not Yours",
      })
      .catch((e) => e);
    expect(err.key).toBe("errors.not_in_pantheon");
    expect(err.params.query).toBe("Not Yours");

    const [row] = await t.sql`SELECT user_id FROM pacts WHERE id = ${p}`;
    expect(row.user_id).toBe(owner);
    const members =
      await t.sql`SELECT 1 FROM guild_members WHERE guild_id = ${g} AND user_id = ${ghost}`;
    expect(members).toHaveLength(0);
  });

  it("recusa doar para si mesmo", async () => {
    const u = uid("u");
    const g = await newGuild(u);
    const p = await seedPact(t.sql, g, u, await seedEntity(t.sql, "Self Gift"));
    expect(
      await keyOf(svc.giveEntity({ guildId: g, fromUserId: u, to: { id: u }, pactId: p }))
    ).toBe("collection.give_self");
  });

  it("doacoes simultaneas do mesmo pacto: so uma passa", async () => {
    const u = uid("u");
    const a = uid("u");
    const b = uid("u");
    const g = await newGuild(u);
    const p = await seedPact(t.sql, g, u, await seedEntity(t.sql, "Race Gift"));
    const rs = await Promise.all([
      keyOf(svc.giveEntity({ guildId: g, fromUserId: u, to: { id: a }, pactId: p })),
      keyOf(svc.giveEntity({ guildId: g, fromUserId: u, to: { id: b }, pactId: p })),
    ]);
    expect(rs.filter((r) => r === "ok")).toHaveLength(1);
    const [row] = await t.sql`SELECT user_id FROM pacts WHERE id = ${p}`;
    expect([a, b]).toContain(row.user_id);
  });
});

describe("setPactText ($note, $alias)", () => {
  it("so o dono grava; vazio limpa; limite de tamanho", async () => {
    const u = uid("u");
    const v = uid("u");
    const g = await newGuild(u, v);
    const p = await seedPact(t.sql, g, u, await seedEntity(t.sql, "Text Target"));

    await svc.setPactText({
      guildId: g,
      userId: u,
      pactId: p,
      field: "note",
      value: "  minha waifu  ",
    });
    await svc.setPactText({ guildId: g, userId: u, pactId: p, field: "alias", value: "tt" });
    await svc.setPactText({ guildId: g, userId: u, pactId: p, field: "alias2", value: "tt2" });
    let [row] = await t.sql`SELECT note, alias, alias2 FROM pacts WHERE id = ${p}`;
    expect(row).toMatchObject({ note: "minha waifu", alias: "tt", alias2: "tt2" });

    expect(
      await keyOf(
        svc.setPactText({ guildId: g, userId: v, pactId: p, field: "note", value: "hack" })
      )
    ).toBe("errors.not_in_pantheon");
    [row] = await t.sql`SELECT note FROM pacts WHERE id = ${p}`;
    expect(row.note).toBe("minha waifu");

    await svc.setPactText({ guildId: g, userId: u, pactId: p, field: "note", value: "" });
    [row] = await t.sql`SELECT note FROM pacts WHERE id = ${p}`;
    expect(row.note).toBeNull();

    const tooLong = await svc
      .setPactText({ guildId: g, userId: u, pactId: p, field: "alias", value: "x".repeat(41) })
      .catch((e) => e);
    expect(tooLong.key).toBe("errors.invalid_argument");
    expect(tooLong.params.arg).toBe("alias");
  });

  it("o apelido gravado passa a localizar o pacto", async () => {
    const u = uid("u");
    const g = await newGuild(u);
    const p = await seedPact(t.sql, g, u, await seedEntity(t.sql, "Long Formal Name"));
    await svc.setPactText({ guildId: g, userId: u, pactId: p, field: "alias2", value: "lfn" });
    expect((await svc.findOwnPact(g, u, "LFN"))?.pactId).toBe(p);
  });
});

describe("busca e autocomplete de entidades", () => {
  let franxx: number;
  let zeroTwo: number;
  let gojo: number;

  beforeAll(async () => {
    franxx = await seedSeries(t.sql, "Darling in the Franxx");
    const jjk = await seedSeries(t.sql, "Jujutsu Kaisen");
    zeroTwo = await seedEntity(t.sql, "Zero Two", { seriesId: franxx, popularityScore: 0.9 });
    await seedEntity(t.sql, "Zero Three", { seriesId: franxx, popularityScore: 0.2 });
    gojo = await seedEntity(t.sql, "Satoru Gojo", { seriesId: jjk, popularityScore: 0.95 });
    await seedEntity(t.sql, "Mikasa Ackerman", { popularityScore: 0.8 });
    await seedEntity(t.sql, "Zero Quarantined", { status: "QUARANTINED", popularityScore: 1 });
    await seedEntity(t.sql, "L", { popularityScore: 0.1 });
    for (let i = 0; i < 40; i++) {
      await seedEntity(t.sql, `Pool Hero ${String(i).padStart(2, "0")}`, { popularityScore: 0.01 });
    }
  }, 60_000);

  it("acha por nome em qualquer ordem de tokens e coloca o exato primeiro", async () => {
    const hits = await svc.searchEntities("two zero");
    expect(hits[0].id).toBe(zeroTwo);
    expect(hits[0].series).toBe("Darling in the Franxx");
    const gojoHits = await svc.searchEntities("gojo satoru");
    expect(gojoHits[0].id).toBe(gojo);
    expect((await svc.searchEntities("ZERO TWO"))[0].id).toBe(zeroTwo);
  });

  it("acha por similaridade (erro de digitacao e termo parcial)", async () => {
    expect((await svc.searchEntities("zero tow"))[0].id).toBe(zeroTwo);
    expect((await svc.searchEntities("mikas"))[0].name).toBe("Mikasa Ackerman");
    expect((await svc.searchEntities("sathoru gojo")).map((h) => h.id)).toContain(gojo);
    const zeros = (await svc.searchEntities("zero")).map((h) => h.name);
    expect(zeros).toEqual(expect.arrayContaining(["Zero Two", "Zero Three"]));
  });

  it("ignora entidades que nao estao ACTIVE", async () => {
    const names = (await svc.searchEntities("zero")).map((h) => h.name);
    expect(names).not.toContain("Zero Quarantined");
  });

  it("limita a 25 e, sem texto, devolve as mais populares", async () => {
    const many = await svc.searchEntities("pool hero", 100);
    expect(many).toHaveLength(25);
    const top = await svc.searchEntities("");
    expect(top).toHaveLength(25);
    expect(top[0].name).toBe("Satoru Gojo");
  });

  it("um caractere so casa nome exato", async () => {
    const hits = await svc.searchEntities("l");
    expect(hits.map((h) => h.name)).toEqual(["L"]);
  });

  it("autocomplete usa o cache de 60 s do KV", async () => {
    const { MemoryStore } = await import("../../../src/infra/redis/memoryStore.js");
    const kv = new MemoryStore();
    const first = await svc.autocompleteEntities(kv, "zero two");
    expect(first[0].id).toBe(zeroTwo);
    expect(await kv.get("cache:ac:entity:two zero")).not.toBeNull();

    // nova entidade que casaria: continua fora do resultado enquanto o cache vale
    await seedEntity(t.sql, "Zero Two Alt", { popularityScore: 0.5 });
    const cached = await svc.autocompleteEntities(kv, "zero two");
    expect(cached.map((h) => h.name)).not.toContain("Zero Two Alt");
    // consulta diferente nao usa a mesma chave
    const fresh = await svc.autocompleteEntities(kv, "zero two alt");
    expect(fresh.map((h) => h.name)).toContain("Zero Two Alt");
    await kv.quit();
  });

  it("findEntityId resolve id:<n>, nome e, sem nome, o mais popular da serie", async () => {
    expect(await svc.findEntityId(`id:${gojo}`)).toBe(gojo);
    expect(await svc.findEntityId("id:999999999")).toBeNull();
    expect(await svc.findEntityId("satoru gojo")).toBe(gojo);
    expect(await svc.findEntityId("franxx")).toBe(zeroTwo);
    expect(await svc.findEntityId("zzzz nada existe aqui")).toBeNull();
  });
});

describe("searchOwnPacts (autocomplete dos proprios pactos)", () => {
  it("lista so os pactos do jogador, filtrando por texto", async () => {
    const u = uid("u");
    const v = uid("u");
    const g = await newGuild(u, v);
    await seedPact(t.sql, g, u, await seedEntity(t.sql, "Kirito Kazuto"));
    await seedPact(t.sql, g, u, await seedEntity(t.sql, "Asuna Yuuki"));
    await seedPact(t.sql, g, v, await seedEntity(t.sql, "Kirigaya Other"));

    const all = await svc.searchOwnPacts(g, u, "");
    expect(all.map((r) => r.name)).toEqual(["Kirito Kazuto", "Asuna Yuuki"]);
    const some = await svc.searchOwnPacts(g, u, "kiri");
    expect(some.map((r) => r.name)).toEqual(["Kirito Kazuto"]);
  });
});

describe("getEntityInfo ($info)", () => {
  it("carta livre: sem pacto", async () => {
    const g = await newGuild();
    const s = await seedSeries(t.sql, "Free Series");
    const e = await seedEntity(t.sql, "Free Card", {
      seriesId: s,
      image: true,
      baseAether: 321,
      tier: "EPIC",
    });
    const info = (await svc.getEntityInfo(g, e))!;
    expect(info).toMatchObject({
      id: e,
      name: "Free Card",
      seriesTitle: "Free Series",
      tier: "EPIC",
      baseAether: 321,
      pact: null,
    });
    expect(info.imageUrl).toBe(`https://x/${e}.png`);
    expect(await svc.getEntityInfo(g, 999999999)).toBeNull();
  });

  it("carta com dono: nome, nota, selos, posicao e cor do embed", async () => {
    const owner = uid("u");
    const g = uid("g");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, owner, { username: "Dona Maria", embedColor: "#FF0000" });
    const first = await seedEntity(t.sql, "Pos One");
    const target = await seedEntity(t.sql, "Pos Two", {
      franchiseId: await seedFranchise(t.sql, "Some Franchise"),
    });
    await seedPact(t.sql, g, owner, first);
    await seedPact(t.sql, g, owner, target, {
      variant: "ASTRAL",
      awakeningKeys: 5,
      aetherAtBind: 700,
      note: "minha nota",
    });

    const info = (await svc.getEntityInfo(g, target))!;
    expect(info.seriesTitle).toBe("Some Franchise"); // sem serie primaria cai na franquia
    expect(info.pact).toMatchObject({
      ownerName: "Dona Maria",
      userId: owner,
      variant: "ASTRAL",
      awakeningKeys: 5,
      aetherAtBind: 700,
      note: "minha nota",
      ownerEmbedColor: "#FF0000",
      position: 2,
    });

    // pacto de outro servidor nao vaza
    const other = await newGuild();
    expect((await svc.getEntityInfo(other, target))!.pact).toBeNull();

    // virar lider muda a posicao
    await svc.setLeader(g, owner, info.pact!.id);
    expect((await svc.getEntityInfo(g, target))!.pact!.position).toBe(1);
  });
});
