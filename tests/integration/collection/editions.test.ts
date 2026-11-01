import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedEntity,
  seedGuild,
  seedMember,
  seedPact,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

let t: TestDb;
type Svc = typeof import("../../../src/modules/collection/service.js");
let svc: Svc;

beforeAll(async () => {
  t = await setupTestDb();
  svc = await import("../../../src/modules/collection/service.js");
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

/** Cria ancora BASIC + EPIC + MYTHIC com o mesmo nome. */
async function seedFamily(name: string) {
  const basic = await seedEntity(t.sql, name, { tier: "COMMON", image: true });
  await t.sql`UPDATE entities SET edition = 'BASIC' WHERE id = ${basic}`;
  const mk = async (edition: "EPIC" | "MYTHIC") => {
    const id = await seedEntity(t.sql, name, { tier: edition, image: true });
    await t.sql`UPDATE entities SET edition = ${edition}, parent_id = ${basic} WHERE id = ${id}`;
    return id;
  };
  return { basic, epic: await mk("EPIC"), mythic: await mk("MYTHIC") };
}

describe("resolveEditionForInfo ($im com nomes repetidos)", () => {
  it("sem pacto: ancora BASIC e lista das tres edicoes em ordem de raridade", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u);
    const f = await seedFamily("Ryuk Edicao");
    for (const start of [f.basic, f.epic, f.mythic]) {
      const r = await svc.resolveEditionForInfo(g, u, start);
      expect(r.entityId).toBe(f.basic);
      expect(r.editions.map((e) => e.edition)).toEqual(["BASIC", "EPIC", "MYTHIC"]);
      expect(r.editions.some((e) => e.owned)).toBe(false);
    }
  });

  it("com pacto: mostra a edicao de maior raridade que o usuario possui", async () => {
    const g = uid("g");
    const me = uid("u");
    const other = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, me);
    await seedMember(t.sql, g, other);
    const f = await seedFamily("Lina Edicao");
    await seedPact(t.sql, g, me, f.basic);
    await seedPact(t.sql, g, me, f.epic);
    await seedPact(t.sql, g, other, f.mythic); // de outro usuario: nao conta

    const r = await svc.resolveEditionForInfo(g, me, f.basic);
    expect(r.entityId).toBe(f.epic);
    expect(r.editions.filter((e) => e.owned).map((e) => e.edition)).toEqual(["BASIC", "EPIC"]);

    await seedPact(t.sql, g, me, f.mythic).catch(() => undefined); // ja pertence a outro neste servidor
    const r2 = await svc.resolveEditionForInfo(g, other, f.epic);
    expect(r2.entityId).toBe(f.mythic);
  });

  it("carta sem edicao ou edicao unica: devolve a propria entidade e lista vazia", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u);
    const plain = await seedEntity(t.sql, "Sem Edicao Alguma", { image: true });
    expect(await svc.resolveEditionForInfo(g, u, plain)).toEqual({ entityId: plain, editions: [] });
    const lone = await seedEntity(t.sql, "Ancora Solitaria", { image: true });
    await t.sql`UPDATE entities SET edition = 'BASIC' WHERE id = ${lone}`;
    expect(await svc.resolveEditionForInfo(g, u, lone)).toEqual({ entityId: lone, editions: [] });
  });

  it("busca por nome devolve as tres edicoes marcadas e o panteao identifica cada uma", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u);
    const f = await seedFamily("Zorbak Triplo");
    const hits = await svc.searchEntities("Zorbak Triplo", 10);
    expect(hits.map((h) => h.edition).sort()).toEqual(["BASIC", "EPIC", "MYTHIC"]);
    await seedPact(t.sql, g, u, f.epic);
    await seedPact(t.sql, g, u, f.mythic);
    const info = await svc.getEntityInfo(g, f.mythic);
    expect(info?.edition).toBe("MYTHIC");
    expect(info?.tier).toBe("MYTHIC");
  });
});
