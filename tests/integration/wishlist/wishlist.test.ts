import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  embedText,
  fakeCtx,
  seedEntity,
  seedFranchise,
  seedGuild,
  seedSeries,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

type Svc = typeof import("../../../src/modules/wishlist/service.js");
type Cmds = typeof import("../../../src/modules/wishlist/commands.js");

let t: TestDb;
let svc: Svc;
let cmds: Cmds;
let newKv: () => Promise<import("../../../src/infra/redis/kv.js").KV>;

beforeAll(async () => {
  t = await setupTestDb();
  svc = await import("../../../src/modules/wishlist/service.js");
  cmds = await import("../../../src/modules/wishlist/commands.js");
  const { MemoryStore } = await import("../../../src/infra/redis/memoryStore.js");
  newKv = async () => new MemoryStore();
}, 120_000);

afterAll(async () => {
  await t?.stop();
}, 60_000);

const errKey = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { key?: string }).key ?? `raw:${(e as Error).message}`;
  }
};

const ref = (guildId: string, userId: string) => ({ guildId, userId, username: userId });

async function wishRows(guildId: string, userId: string) {
  return t.sql`SELECT entity_id::int AS "entityId", is_starwish AS "isStarwish"
               FROM wishes WHERE guild_id = ${guildId} AND user_id = ${userId}
               ORDER BY entity_id`;
}

describe("applyWish / removeWish", () => {
  it("add cria guilda, usuario e membro (FK composta) e a linha; repetir devolve exists", async () => {
    const g = uid("g");
    const u = uid("u");
    const e = await seedEntity(t.sql, "Zero Two");

    const first = await svc.addWish(ref(g, u), e);
    expect(first).toEqual({ status: "added", isStarwish: false, total: 1 });
    const members = await t.sql`SELECT 1 FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`;
    expect(members).toHaveLength(1);

    const again = await svc.addWish(ref(g, u), e);
    expect(again).toEqual({ status: "exists", isStarwish: false, total: 1 });
    expect(await wishRows(g, u)).toHaveLength(1);
  });

  it("toggle remove o desejo existente; removeWish informa se existia", async () => {
    const g = uid("g");
    const u = uid("u");
    const e = await seedEntity(t.sql, "Subaru");
    await svc.addWish(ref(g, u), e);

    const toggled = await svc.toggleWish(ref(g, u), e);
    expect(toggled).toEqual({ status: "removed", isStarwish: false, total: 0 });
    expect(await wishRows(g, u)).toHaveLength(0);

    await svc.addWish(ref(g, u), e);
    expect(await svc.removeWish(g, u, e)).toBe(true);
    expect(await svc.removeWish(g, u, e)).toBe(false);
  });

  it("limite: a lista cheia recusa nova entrada com wishlist.limit_reached e libera ao remover", async () => {
    const g = uid("g");
    const u = uid("u");
    const ids: number[] = [];
    for (let i = 0; i < svc.WISH_LIMIT; i++) ids.push(await seedEntity(t.sql, `Limite ${i}`));
    for (const id of ids) await svc.addWish(ref(g, u), id);

    const extra = await seedEntity(t.sql, "Limite extra");
    const err = await svc.addWish(ref(g, u), extra).catch((e) => e);
    expect(err.key).toBe("wishlist.limit_reached");
    expect(err.params).toEqual({ max: svc.WISH_LIMIT });
    expect(await wishRows(g, u)).toHaveLength(svc.WISH_LIMIT);

    // repetir um desejo ja existente com a lista cheia nao e erro
    expect((await svc.addWish(ref(g, u), ids[0]!)).status).toBe("exists");

    await svc.removeWish(g, u, ids[0]!);
    expect((await svc.addWish(ref(g, u), extra)).status).toBe("added");
  });

  it("limite sob concorrencia: 15 adicoes simultaneas gravam exatamente WISH_LIMIT", async () => {
    const g = uid("g");
    const u = uid("u");
    const ids: number[] = [];
    for (let i = 0; i < 15; i++) ids.push(await seedEntity(t.sql, `Corrida ${i}`));
    const results = await Promise.all(ids.map((id) => errKey(svc.addWish(ref(g, u), id))));
    expect(results.filter((r) => r === "ok")).toHaveLength(svc.WISH_LIMIT);
    expect(results.filter((r) => r === "wishlist.limit_reached")).toHaveLength(15 - svc.WISH_LIMIT);
    expect(await wishRows(g, u)).toHaveLength(svc.WISH_LIMIT);
  });

  it("starwish: promove um desejo comum e respeita STARWISH_LIMIT", async () => {
    const g = uid("g");
    const u = uid("u");
    const ids: number[] = [];
    for (let i = 0; i < svc.STARWISH_LIMIT + 2; i++) ids.push(await seedEntity(t.sql, `Estrela ${i}`));

    // promocao de um desejo ja existente
    await svc.addWish(ref(g, u), ids[0]!);
    expect(await svc.addWish(ref(g, u), ids[0]!, { starwish: true })).toEqual({
      status: "upgraded",
      isStarwish: true,
      total: 1,
    });

    for (let i = 1; i < svc.STARWISH_LIMIT; i++) {
      expect((await svc.addWish(ref(g, u), ids[i]!, { starwish: true })).status).toBe("added");
    }
    const over = ids[svc.STARWISH_LIMIT]!;
    expect(await errKey(svc.addWish(ref(g, u), over, { starwish: true }))).toBe(
      "wishlist.starwish_limit_reached"
    );
    // um desejo comum ainda cabe
    expect((await svc.addWish(ref(g, u), over)).status).toBe("added");
    // e promove-lo estoura o limite de estelares
    expect(await errKey(svc.addWish(ref(g, u), over, { starwish: true }))).toBe(
      "wishlist.starwish_limit_reached"
    );
  });

  it("toggle com starwish: promove o comum, remove o estelar", async () => {
    const g = uid("g");
    const u = uid("u");
    const e = await seedEntity(t.sql, "Alternar");
    await svc.addWish(ref(g, u), e);
    expect((await svc.toggleWish(ref(g, u), e, { starwish: true })).status).toBe("upgraded");
    expect((await svc.toggleWish(ref(g, u), e, { starwish: true })).status).toBe("removed");
  });

  it("listWishes: estelares primeiro, com serie/franquia, sem SELECT *", async () => {
    const g = uid("g");
    const u = uid("u");
    const fr = await seedFranchise(t.sql, "Fate");
    const s = await seedSeries(t.sql, "Fate/Zero", fr);
    const a = await seedEntity(t.sql, "Alfa", { seriesId: s, baseAether: 321 });
    const b = await seedEntity(t.sql, "Beta", { franchiseId: fr });
    const c = await seedEntity(t.sql, "Gama");
    await svc.addWish(ref(g, u), a);
    await svc.addWish(ref(g, u), b);
    await svc.addWish(ref(g, u), c, { starwish: true });

    const list = await svc.listWishes(g, u);
    expect(list.map((w) => w.name)).toEqual(["Gama", "Alfa", "Beta"]);
    expect(list[0]!.isStarwish).toBe(true);
    expect(list[1]).toMatchObject({ seriesTitle: "Fate/Zero", franchiseName: null, baseAether: 321 });
    expect(list[2]).toMatchObject({ seriesTitle: null, franchiseName: "Fate" });

    // isolamento por servidor e por usuario
    expect(await svc.listWishes(uid("g"), u)).toEqual([]);
    expect(await svc.listWishes(g, uid("u"))).toEqual([]);
  });
});

describe("busca e autocomplete (pg_trgm sobre name_normalized)", () => {
  let zeroTwo: number;
  let emilia: number;
  let gojo: number;
  let rem: number;
  let remilia: number;
  let adult: number;
  let quarantined: number;

  beforeAll(async () => {
    const darling = await seedSeries(t.sql, "Darling in the FranXX");
    zeroTwo = await seedEntity(t.sql, "Zero Two", { seriesId: darling, popularity: 0.9 });
    emilia = await seedEntity(t.sql, "Emilia", { popularity: 0.7 });
    gojo = await seedEntity(t.sql, "Satoru Gojo", { popularity: 0.95 });
    rem = await seedEntity(t.sql, "Rem", { popularity: 0.8 });
    remilia = await seedEntity(t.sql, "Remilia Scarlet", { popularity: 0.5 });
    adult = await seedEntity(t.sql, "Zero Adulta", { isAdult: true });
    quarantined = await seedEntity(t.sql, "Zero Oculta", { status: "QUARANTINED" });
    for (let i = 0; i < 30; i++) await seedEntity(t.sql, `Bulk ${String.fromCharCode(97 + (i % 26))}${i}`);
  });

  const names = (hits: { name: string }[]) => hits.map((h) => h.name);

  it("acha por nome exato, em qualquer ordem dos tokens e com o nome da serie", async () => {
    const exact = await svc.searchEntities("zero two");
    expect(exact[0]).toMatchObject({ id: zeroTwo, name: "Zero Two", seriesTitle: "Darling in the FranXX" });
    expect((await svc.searchEntities("two zero"))[0]!.id).toBe(zeroTwo);
    expect((await svc.searchEntities("Satoru Gojo"))[0]!.id).toBe(gojo);
    expect((await svc.searchEntities("gojo satoru"))[0]!.id).toBe(gojo);
  });

  it("acha por digitacao parcial e por erro de digitacao (similaridade)", async () => {
    expect(names(await svc.searchEntities("zero tw"))).toContain("Zero Two");
    expect(names(await svc.searchEntities("goj"))).toContain("Satoru Gojo");
    expect((await svc.searchEntities("emila"))[0]!.id).toBe(emilia);
    expect((await svc.searchEntities("EMILIA"))[0]!.id).toBe(emilia);
  });

  it("ordena igualdade exata, depois similaridade (Rem antes de Remilia Scarlet)", async () => {
    const hits = await svc.searchEntities("rem");
    expect(hits.slice(0, 2).map((h) => h.id)).toEqual([rem, remilia]);
  });

  it("so ACTIVE; conteudo adulto exige allowAdult", async () => {
    const hits = await svc.searchEntities("zero");
    expect(hits.map((h) => h.id)).not.toContain(quarantined);
    expect(hits.map((h) => h.id)).not.toContain(adult);
    const withAdult = await svc.searchEntities("zero", { allowAdult: true });
    expect(withAdult.map((h) => h.id)).toContain(adult);
    expect(withAdult.map((h) => h.id)).not.toContain(quarantined);
  });

  it("LIMIT 25 e consulta curta/vazia devolve as mais populares", async () => {
    expect((await svc.searchEntities("bulk")).length).toBe(25);
    const popular = await svc.searchEntities("", { popularWhenShort: true });
    expect(popular).toHaveLength(25);
    expect(popular[0]!.id).toBe(gojo);
    expect(await svc.searchEntities("")).toEqual([]);
    expect(await svc.searchEntities("   ")).toEqual([]);
  });

  it("consulta com % _ ou aspas nao quebra nem vira curinga", async () => {
    expect(await svc.searchEntities("%%%")).toEqual([]);
    expect(await svc.searchEntities("a_b'c\\")).toEqual(expect.any(Array));
  });

  it("resolveEntity: id:N do autocomplete e texto", async () => {
    expect((await svc.resolveEntity(`id:${zeroTwo}`))?.name).toBe("Zero Two");
    expect(await svc.resolveEntity(`id:${quarantined}`)).toBeNull();
    expect(await svc.resolveEntity(`id:${adult}`)).toBeNull();
    expect((await svc.resolveEntity(`id:${adult}`, { allowAdult: true }))?.id).toBe(adult);
    expect((await svc.resolveEntity("gojo"))?.id).toBe(gojo);
    expect(await svc.resolveEntity("xyzzyqq")).toBeNull();
  });

  it("autocompleteEntities: cache de 60 s no KV (segunda chamada nao toca o banco)", async () => {
    const kv = await newKv();
    const search = vi.fn(svc.searchEntities);
    const first = await svc.autocompleteEntities(kv, "emilia", false, { search });
    expect(first[0]!.id).toBe(emilia);

    // muda o banco: a resposta em cache continua a mesma, inclusive com tokens em outra ordem
    await t.sql`UPDATE entities SET status = 'DISABLED' WHERE id = ${emilia}`;
    const second = await svc.autocompleteEntities(kv, "emilia", false, { search });
    expect(second[0]!.id).toBe(emilia);
    expect(search).toHaveBeenCalledTimes(1);
    await t.sql`UPDATE entities SET status = 'ACTIVE' WHERE id = ${emilia}`;

    // chave distinta para adulto/nao adulto
    await svc.autocompleteEntities(kv, "emilia", true, { search });
    expect(search).toHaveBeenCalledTimes(2);
    expect(await kv.pttl("cache:ac:entity:n:emilia")).toBeGreaterThan(50_000);
  });

  it("autocompleteWishes: so o que ja esta na lista, filtrado pelo texto", async () => {
    const g = uid("g");
    const u = uid("u");
    await svc.addWish(ref(g, u), zeroTwo);
    await svc.addWish(ref(g, u), rem);
    expect(names(await svc.autocompleteWishes(g, u, ""))).toEqual(["Zero Two", "Rem"]);
    expect(names(await svc.autocompleteWishes(g, u, "zero"))).toEqual(["Zero Two"]);
    expect(await svc.autocompleteWishes(g, u, "emilia")).toEqual([]);
    expect(await svc.autocompleteWishes(g, uid("u"), "")).toEqual([]);
  });

  it("guildAllowsAdult le allow_adult da guilda (cacheado)", async () => {
    const kv = await newKv();
    const open = uid("g");
    const closed = uid("g");
    await seedGuild(t.sql, open, { allowAdult: true });
    await seedGuild(t.sql, closed);
    expect(await svc.guildAllowsAdult(kv, open)).toBe(true);
    expect(await svc.guildAllowsAdult(kv, closed)).toBe(false);
    expect(await svc.guildAllowsAdult(kv, uid("g"))).toBe(false);
  });
});

describe("comandos com banco real", () => {
  const args = (o: Record<string, unknown>) => ({ star: false, ...o });

  it("$wish <nome> adiciona e alterna; $wl lista; $wish remove <nome> remove", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedEntity(t.sql, "Mikasa Ackerman", { popularity: 0.5 });

    const add = fakeCtx({ guildId: g, userId: u, args: args({ action: "toggle", query: "mikasa" }) });
    await cmds.runWish(add.ctx);
    expect(embedText(add.replies[0])).toContain("Mikasa Ackerman");
    expect((await wishRows(g, u)).length).toBe(1);

    const list = fakeCtx({ guildId: g, userId: u, args: args({ action: "list" }) });
    await cmds.runWish(list.ctx);
    const listed = embedText(list.replies[0]);
    expect(listed).toContain("Mikasa Ackerman");
    expect(listed).toContain("1/10");

    const remove = fakeCtx({ guildId: g, userId: u, args: args({ action: "remove", query: "mikasa" }) });
    await cmds.runWish(remove.ctx);
    expect(await wishRows(g, u)).toHaveLength(0);

    const empty = fakeCtx({ guildId: g, userId: u, args: args({ action: "list" }) });
    await cmds.runWish(empty.ctx);
    expect(embedText(empty.replies[0])).toContain("$wish");
  });

  it("entidade desconhecida e remocao de quem nao esta na lista viram UserError", async () => {
    const g = uid("g");
    const u = uid("u");
    const missing = fakeCtx({ guildId: g, userId: u, args: args({ action: "add", query: "qqqzzzxx" }) });
    const err = await cmds.runWish(missing.ctx).catch((e) => e);
    expect(err.key).toBe("wishlist.not_found");
    expect(err.params).toMatchObject({ query: "qqqzzzxx", prefix: "$" });

    const none = fakeCtx({ guildId: g, userId: u, args: args({ action: "remove", query: "mikasa" }) });
    expect((await cmds.runWish(none.ctx).catch((e) => e)).key).toBe("wishlist.not_in_list");
  });

  it("slash add por id:N do autocomplete e starwish pelo comando $sw", async () => {
    const g = uid("g");
    const u = uid("u");
    const e = await seedEntity(t.sql, "Frieren");
    const add = fakeCtx({ guildId: g, userId: u, args: args({ action: "add", query: `id:${e}` }) });
    await cmds.runWish(add.ctx);
    const again = fakeCtx({ guildId: g, userId: u, args: args({ action: "add", query: `id:${e}` }) });
    await cmds.runWish(again.ctx);
    expect(embedText(again.replies[0])).toContain("Frieren");
    expect(await wishRows(g, u)).toHaveLength(1);

    const star = fakeCtx({ guildId: g, userId: u, args: args({ action: "toggle", query: "frieren", star: true }) });
    await cmds.starwishCommand.execute(star.ctx);
    expect((await wishRows(g, u))[0]).toMatchObject({ isStarwish: true });
  });
});
