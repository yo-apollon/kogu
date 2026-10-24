import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbExecutor } from "../../../src/catalog/executor.js";
import type { RawCharacter, RawSeries } from "../../../src/catalog/types.js";
import type { CharacterFinder, CharacterMatch } from "../../../src/modules/catalog/anilist.js";
import { seedEntity, seedGuild, seedUser, setupTestDb, uid, type TestDb } from "./helpers.js";

type Svc = typeof import("../../../src/modules/catalog/service.js");

let t: TestDb;
let svc: Svc;
let db: DbExecutor;

beforeAll(async () => {
  t = await setupTestDb();
  svc = await import("../../../src/modules/catalog/service.js");
  db = (await import("../../../src/infra/db/client.js")).db as unknown as DbExecutor;
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

let counter = 1000;
function match(
  o: Partial<{
    name: string;
    gender: RawCharacter["gender"];
    favourites: number;
    adult: boolean;
    image: boolean;
  }> = {}
): CharacterMatch {
  const n = ++counter;
  const series: RawSeries = {
    source: "ANILIST",
    externalId: String(n),
    title: `Saga Zeta${n}`,
    mediaType: "ANIME",
    status: "FINISHED",
    popularity: 1000,
    isAdult: o.adult ?? false,
    coverUrl: "https://s4.anilist.co/cover.jpg",
  };
  const character: RawCharacter = {
    source: "ANILIST",
    externalId: String(n * 10),
    name: o.name ?? `Heroi Omega${n}`,
    gender: o.gender ?? "MALE",
    favourites: o.favourites ?? 500,
    seriesExternalId: series.externalId,
    imageUrl: o.image === false ? undefined : `https://s4.anilist.co/char${n}.png`,
    role: "MAIN",
    isAdult: o.adult ?? false,
  };
  return { series, character };
}
const finderOf = (m: CharacterMatch | null): CharacterFinder => ({ find: async () => m });

const OWNER = { id: "owner-1", isOwner: true };
const MEMBER = { id: "member-1", isOwner: false };

const one = async <T = any>(q: PromiseLike<readonly unknown[]>): Promise<T> => (await q)[0] as T;

describe("papeis e cota de $import", () => {
  it("resolveImportRole: owner > vip > denied", async () => {
    const vip = uid("vip");
    const normal = uid("normal");
    await seedUser(t.sql, vip, { vipTier: 1 });
    await seedUser(t.sql, normal, { vipTier: 0 });
    const isOwner = (id: string) => id === "boss";
    expect(await svc.resolveImportRole(db, "boss", isOwner)).toBe("owner");
    expect(await svc.resolveImportRole(db, vip, isOwner)).toBe("vip");
    expect(await svc.resolveImportRole(db, normal, isOwner)).toBe("denied");
    expect(await svc.resolveImportRole(db, "desconhecido", isOwner)).toBe("denied");
  });

  it("VIP: 2 importacoes por dia, devolve e reinicia no dia seguinte (UTC)", async () => {
    const u = uid("vip");
    await seedUser(t.sql, u, { vipTier: 2 });
    const now = new Date();
    expect(await svc.claimVipImport(db, u, { now })).toEqual({ ok: true, used: 1 });
    expect(await svc.claimVipImport(db, u, { now })).toEqual({ ok: true, used: 2 });
    expect(await svc.claimVipImport(db, u, { now })).toEqual({ ok: false });

    await svc.refundVipImport(db, u, { now });
    expect(await svc.claimVipImport(db, u, { now })).toEqual({ ok: true, used: 2 });
    expect(await svc.claimVipImport(db, u, { now })).toEqual({ ok: false });

    const tomorrow = new Date(now.getTime() + 36 * 3_600_000);
    expect(await svc.claimVipImport(db, u, { now: tomorrow })).toEqual({ ok: true, used: 1 });
    expect(await svc.claimVipImport(db, u, { now: tomorrow })).toEqual({ ok: true, used: 2 });
    expect(await svc.claimVipImport(db, u, { now: tomorrow })).toEqual({ ok: false });
  });

  it("devolver nao fica negativo e usuario inexistente nao consome", async () => {
    const u = uid("vip");
    await seedUser(t.sql, u, { vipTier: 1 });
    await svc.refundVipImport(db, u);
    const row = await one<{ c: number }>(t.sql`SELECT daily_imports_count AS c FROM users WHERE id = ${u}`);
    expect(row.c).toBe(0);
    expect(await svc.claimVipImport(db, "ninguem")).toEqual({ ok: false });
  });

  it("6 claims concorrentes com limite 2 deixam passar exatamente 2", async () => {
    const u = uid("vip");
    await seedUser(t.sql, u, { vipTier: 3 });
    const rs = await Promise.all(Array.from({ length: 6 }, () => svc.claimVipImport(db, u)));
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
  });
});

describe("importCharacter (pipeline)", () => {
  it("bom candidato de VIP entra ACTIVE com Eter provisorio e ids externos", async () => {
    await seedEntity(t.sql, "Lower One", { favorites: 5 });
    await seedEntity(t.sql, "Lower Two", { favorites: 6 });
    const m = match({ favourites: 99_999 });
    const out = await svc.importCharacter("x", { db, finder: finderOf(m), actor: MEMBER });
    expect(out.kind).toBe("imported");
    if (out.kind !== "imported") return;
    expect(out.created).toBe(true);
    expect(out.activated).toBe(false);
    expect(out.entity.status).toBe("ACTIVE");
    expect(out.entity.pendingReasons).toEqual([]);
    expect(out.entity.aether).toBeGreaterThan(40);
    expect(out.anilistId).toBe(Number(m.character.externalId));

    const e = await one<any>(
      t.sql`SELECT e.status, e.universe, e.gender, e.source_favorites AS fav, e.base_aether AS aether,
                   (SELECT count(*)::int FROM entity_external_ids x WHERE x.entity_id = e.id AND x.source = 'ANILIST' AND x.external_id = ${m.character.externalId}) AS ext,
                   (SELECT count(*)::int FROM entity_images i WHERE i.entity_id = e.id AND i.is_primary) AS img,
                   (SELECT count(*)::int FROM entity_series s WHERE s.entity_id = e.id) AS ser
            FROM entities e WHERE e.id = ${out.entity.id}`
    );
    expect(e).toMatchObject({ status: "ACTIVE", universe: "ANIME", gender: "MALE", fav: 99_999, ext: 1, img: 1, ser: 1 });
    expect(e.aether).toBe(out.entity.aether);

    // reimportar: ja existe, nada novo
    const again = await svc.importCharacter("x", { db, finder: finderOf(m), actor: MEMBER });
    expect(again.kind).toBe("exists");
    const count = await one<{ n: number }>(
      t.sql`SELECT count(*)::int AS n FROM entity_external_ids WHERE source = 'ANILIST' AND external_id = ${m.character.externalId}`
    );
    expect(count.n).toBe(1);
  });

  it("nao achou no AniList: not_found e nada gravado", async () => {
    const before = await one<{ n: number }>(t.sql`SELECT count(*)::int AS n FROM entities`);
    expect(await svc.importCharacter("zzz", { db, finder: finderOf(null), actor: OWNER })).toEqual({ kind: "not_found" });
    const after = await one<{ n: number }>(t.sql`SELECT count(*)::int AS n FROM entities`);
    expect(after.n).toBe(before.n);
  });

  it("poucos favoritos: VIP segue a quarentena (QUARANTINED + fila LOW_FAVORITES)", async () => {
    const m = match({ favourites: 3 });
    const out = await svc.importCharacter("x", { db, finder: finderOf(m), actor: MEMBER });
    expect(out.kind).toBe("imported");
    if (out.kind !== "imported") return;
    expect(out.entity.status).toBe("QUARANTINED");
    expect(out.entity.pendingReasons).toEqual(["LOW_FAVORITES"]);
    const rows = await t.sql`SELECT reason, status FROM moderation_queue WHERE entity_id = ${out.entity.id}`;
    expect(rows.map((r) => [r.reason, r.status])).toEqual([["LOW_FAVORITES", "PENDING"]]);
  });

  it("owner ativa direto; a dispensa e humana e persiste em novas importacoes/syncs", async () => {
    const m = match({ favourites: 3 });
    const out = await svc.importCharacter("x", { db, finder: finderOf(m), actor: OWNER });
    expect(out.kind).toBe("imported");
    if (out.kind !== "imported") return;
    expect(out.entity.status).toBe("ACTIVE");
    const row = await one<any>(
      t.sql`SELECT status, reviewed_by FROM moderation_queue WHERE entity_id = ${out.entity.id} AND reason = 'LOW_FAVORITES'`
    );
    expect(row).toMatchObject({ status: "APPROVED", reviewed_by: OWNER.id });

    // um "sync" posterior (mesmo upsert) nao reabre a pendencia nem rebaixa a entidade
    const again = await svc.importCharacter("x", { db, finder: finderOf(m), actor: MEMBER });
    expect(again.kind).toBe("exists");
    if (again.kind !== "exists") return;
    expect(again.entity.status).toBe("ACTIVE");
    const pending = await one<{ n: number }>(
      t.sql`SELECT count(*)::int AS n FROM moderation_queue WHERE entity_id = ${out.entity.id} AND status = 'PENDING'`
    );
    expect(pending.n).toBe(0);
  });

  it("owner reativa na reimportacao uma entidade que o VIP deixou em quarentena", async () => {
    const m = match({ favourites: 2 });
    const first = await svc.importCharacter("x", { db, finder: finderOf(m), actor: MEMBER });
    expect(first.kind === "imported" && first.entity.status).toBe("QUARANTINED");
    const second = await svc.importCharacter("x", { db, finder: finderOf(m), actor: OWNER });
    expect(second.kind).toBe("imported");
    if (second.kind !== "imported") return;
    expect(second.created).toBe(false);
    expect(second.activated).toBe(true);
    expect(second.entity.status).toBe("ACTIVE");
  });

  it("genero desconhecido continua na fila mesmo para owner (nunca sorteado)", async () => {
    const m = match({ gender: "UNKNOWN" });
    const out = await svc.importCharacter("x", { db, finder: finderOf(m), actor: OWNER });
    expect(out.kind).toBe("imported");
    if (out.kind !== "imported") return;
    expect(out.activated).toBe(false);
    expect(out.entity.status).toBe("QUARANTINED");
    expect(out.entity.pendingReasons).toContain("UNKNOWN_GENDER");
  });

  it("sem imagem continua na fila mesmo para owner", async () => {
    const out = await svc.importCharacter("x", { db, finder: finderOf(match({ image: false })), actor: OWNER });
    expect(out.kind === "imported" && out.entity.status).toBe("QUARANTINED");
    expect(out.kind === "imported" && out.entity.pendingReasons).toContain("NO_IMAGE");
  });

  it("conteudo adulto: VIP em quarentena, owner ativa (is_adult preservado)", async () => {
    const vip = await svc.importCharacter("x", { db, finder: finderOf(match({ adult: true })), actor: MEMBER });
    expect(vip.kind === "imported" && vip.entity.pendingReasons).toEqual(["ADULT_CONTENT"]);
    const m = match({ adult: true });
    const owner = await svc.importCharacter("x", { db, finder: finderOf(m), actor: OWNER });
    expect(owner.kind === "imported" && owner.entity.status).toBe("ACTIVE");
    const row = await one<{ is_adult: boolean }>(
      t.sql`SELECT is_adult FROM entities e JOIN entity_external_ids x ON x.entity_id = e.id WHERE x.external_id = ${m.character.externalId}`
    );
    expect(row.is_adult).toBe(true);
  });

  it("entidade desativada nao e reimportada", async () => {
    const m = match();
    const out = await svc.importCharacter("x", { db, finder: finderOf(m), actor: OWNER });
    if (out.kind !== "imported") throw new Error("esperava imported");
    await t.sql`UPDATE entities SET status = 'DISABLED' WHERE id = ${out.entity.id}`;
    const again = await svc.importCharacter("x", { db, finder: finderOf(m), actor: OWNER });
    expect(again.kind).toBe("disabled");
  });
});

describe("sugestoes", () => {
  const input = (guildId: string, userId: string, characterName: string) => ({
    guildId,
    userId,
    username: `nome-${userId}`,
    characterName,
  });

  it("cria a sugestao na fila (e a guild/usuario se faltarem)", async () => {
    const g = uid("g");
    const u = uid("u");
    const r = await svc.createSuggestion(db, input(g, u, "  Eren   Yeager "));
    expect(r.status).toBe("created");
    const row = await one<any>(
      t.sql`SELECT guild_id, user_id, character_name, status FROM character_suggestions WHERE guild_id = ${g}`
    );
    expect(row).toEqual({ guild_id: g, user_id: u, character_name: "Eren Yeager", status: "PENDING" });
    const user = await one<{ username: string }>(t.sql`SELECT username FROM users WHERE id = ${u}`);
    expect(user.username).toBe(`nome-${u}`);
  });

  it("limite de pendentes por usuario", async () => {
    const g = uid("g");
    const u = uid("u");
    for (let i = 0; i < svc.SUGGEST_MAX_PENDING; i++) {
      expect((await svc.createSuggestion(db, input(g, u, `Limite Nome${u}${i}`))).status).toBe("created");
    }
    expect(await svc.createSuggestion(db, input(g, u, `Limite Extra${u}`))).toEqual({
      status: "limit",
      max: svc.SUGGEST_MAX_PENDING,
    });
    // outro usuario nao e afetado
    expect((await svc.createSuggestion(db, input(g, uid("u"), `Outro Nome${u}`))).status).toBe("created");
  });

  it("8 sugestoes concorrentes do mesmo usuario respeitam o limite de 5", async () => {
    const g = uid("g");
    const u = uid("u");
    const rs = await Promise.all(
      Array.from({ length: 8 }, (_, i) => svc.createSuggestion(db, input(g, u, `Conc Pessoa${u}x${i}`)))
    );
    expect(rs.filter((r) => r.status === "created")).toHaveLength(5);
    expect(rs.filter((r) => r.status === "limit")).toHaveLength(3);
  });

  it("recusa nome ja pendente (qualquer usuario, sem diferenciar caixa) e nome ja no catalogo", async () => {
    const g = uid("g");
    const name = `Dup Nome${uid("n")}`;
    expect((await svc.createSuggestion(db, input(g, uid("u"), name))).status).toBe("created");
    expect(await svc.createSuggestion(db, input(g, uid("u"), name.toUpperCase()))).toEqual({ status: "duplicate" });

    const franchise = `Franq${uid("f")}`;
    const fid = (await one<{ id: number }>(t.sql`INSERT INTO franchises (slug, name) VALUES (${franchise}, ${franchise}) RETURNING id::int AS id`)).id;
    const unique = `Zeke${uid("z")} Yeagerx`;
    await seedEntity(t.sql, unique, { franchiseId: fid });
    const r = await svc.createSuggestion(db, input(g, uid("u"), unique.toLowerCase().split(" ").reverse().join(" ")));
    expect(r).toMatchObject({ status: "exists", entityName: unique, franchise });
  });

  it("lista pendentes por servidor ou global, com paginacao", async () => {
    const g1 = uid("g");
    const g2 = uid("g");
    await seedGuild(t.sql, g1);
    for (let i = 0; i < 3; i++) await svc.createSuggestion(db, input(g1, uid("u"), `Lista ${g1} n${i}`));
    await svc.createSuggestion(db, input(g2, uid("u"), `Lista ${g2} unico`));

    const page1 = await svc.listPendingSuggestions(db, { guildId: g1, limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.rows.map((r) => r.characterName)).toEqual([`Lista ${g1} n0`, `Lista ${g1} n1`]);
    const page2 = await svc.listPendingSuggestions(db, { guildId: g1, limit: 2, offset: 2 });
    expect(page2.rows.map((r) => r.characterName)).toEqual([`Lista ${g1} n2`]);
    const mine2 = await svc.listPendingSuggestions(db, { guildId: g2, limit: 10, offset: 0 });
    expect(mine2.total).toBe(1);
    const global = await svc.listPendingSuggestions(db, { limit: 1000, offset: 0 });
    expect(global.total).toBeGreaterThanOrEqual(4);
  });

  it("aprovar: reserva (so um staff leva), importa, resolve com a entidade; falha devolve a fila", async () => {
    const g = uid("g");
    const u = uid("u");
    const name = `Aprova Fulano${uid("a")}`;
    await svc.createSuggestion(db, input(g, u, name));

    const found = await svc.findPendingSuggestion(db, name.toLowerCase().slice(0, 14), { guildId: g });
    expect(found?.characterName).toBe(name);
    expect(await svc.findPendingSuggestion(db, name, { guildId: "outra-guild" })).toBeNull();

    const results = await Promise.all([
      svc.claimSuggestion(db, found!.id, "staff-1"),
      svc.claimSuggestion(db, found!.id, "staff-2"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    // importacao falhou: volta para PENDING
    await svc.releaseSuggestion(db, found!.id);
    const back = await one<any>(t.sql`SELECT status, reviewed_by FROM character_suggestions WHERE id = ${found!.id}`);
    expect(back).toEqual({ status: "PENDING", reviewed_by: null });

    // fluxo completo
    expect(await svc.claimSuggestion(db, found!.id, "staff-1")).toBe(true);
    const m = match({ name });
    const out = await svc.importCharacter(name, { db, finder: finderOf(m), actor: MEMBER });
    if (out.kind !== "imported") throw new Error("esperava imported");
    await svc.resolveSuggestion(db, found!.id, { entityId: out.entity.id, anilistId: out.anilistId });
    const done = await one<any>(
      t.sql`SELECT status, reviewed_by, resolved_entity_id::int AS entity, anilist_id FROM character_suggestions WHERE id = ${found!.id}`
    );
    expect(done).toMatchObject({
      status: "APPROVED",
      reviewed_by: "staff-1",
      entity: out.entity.id,
      anilist_id: Number(m.character.externalId),
    });
    expect(await svc.findPendingSuggestion(db, name, { guildId: g })).toBeNull();
  });
});
