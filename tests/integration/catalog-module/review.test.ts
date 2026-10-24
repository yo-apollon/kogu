import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "../../../src/catalog/executor.js";
import {
  seedEntity,
  seedFranchise,
  seedModeration,
  seedPact,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

type Review = typeof import("../../../src/modules/catalog/review.js");
type Svc = typeof import("../../../src/modules/catalog/service.js");
type Components = typeof import("../../../src/modules/catalog/components.js");

let t: TestDb;
let review: Review;
let svc: Svc;
let components: Components;
let db: DbExecutor;
let loadWaivers: typeof import("../../../src/catalog/quarantine.js").loadWaivers;

beforeAll(async () => {
  t = await setupTestDb();
  review = await import("../../../src/modules/catalog/review.js");
  svc = await import("../../../src/modules/catalog/service.js");
  components = await import("../../../src/modules/catalog/components.js");
  loadWaivers = (await import("../../../src/catalog/quarantine.js")).loadWaivers;
  db = (await import("../../../src/infra/db/client.js")).db as unknown as DbExecutor;
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

beforeEach(async () => {
  // cada teste parte de uma fila vazia
  await t.sql`UPDATE moderation_queue SET status = 'REJECTED' WHERE status = 'PENDING'`;
});

const MOD = "mod-1";
const one = async <T = any>(q: PromiseLike<readonly unknown[]>): Promise<T> => (await q)[0] as T;
const entityRow = (id: number) =>
  one<any>(t.sql`SELECT status, gender, name, name_normalized, merged_into_id::int AS merged FROM entities WHERE id = ${id}`);
const rowOf = (id: number) =>
  one<any>(t.sql`SELECT status, reviewed_by, details FROM moderation_queue WHERE id = ${id}`);
const quarantined = (name: string, o: Parameters<typeof seedEntity>[2] = {}) =>
  seedEntity(t.sql, name, { status: "QUARANTINED", ...o });

describe("isCatalogModerator", () => {
  it("owner, linha em catalog_moderators e desconhecido", async () => {
    const mod = uid("mod");
    await t.sql`INSERT INTO catalog_moderators (user_id) VALUES (${mod})`;
    const owner = (id: string) => id === "o1";
    expect(await review.isCatalogModerator(db, "o1", owner)).toBe(true);
    expect(await review.isCatalogModerator(db, mod, owner)).toBe(true);
    expect(await review.isCatalogModerator(db, "estranho", owner)).toBe(false);
  });
});

describe("navegacao da fila", () => {
  it("first/next/prev com volta, contagem e item ja fechado como ponto de partida", async () => {
    expect(await review.firstPendingId(db)).toBeNull();
    expect(await review.neighborPendingId(db, 1, "next")).toBeNull();

    const e = await quarantined("Nav Um");
    const a = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const b = await seedModeration(t.sql, { entityId: e, reason: "ADULT_CONTENT" });
    const c = await seedModeration(t.sql, { entityId: e, reason: "NO_IMAGE" });

    expect(await review.firstPendingId(db)).toBe(a);
    expect(await review.neighborPendingId(db, a, "next")).toBe(b);
    expect(await review.neighborPendingId(db, b, "next")).toBe(c);
    expect(await review.neighborPendingId(db, c, "next")).toBe(a); // volta
    expect(await review.neighborPendingId(db, a, "prev")).toBe(c); // volta
    expect(await review.queueCounts(db, b)).toEqual({ total: 3, position: 2 });

    await t.sql`UPDATE moderation_queue SET status = 'APPROVED' WHERE id = ${b}`;
    expect(await review.neighborPendingId(db, b, "next")).toBe(c);
    expect(await review.neighborPendingId(db, b, "prev")).toBe(a);
    expect(await review.queueCounts(db, c)).toEqual({ total: 2, position: 2 });
  });

  it("getQueueItem traz entidade, serie/franquia, duplicata e motivos irmaos", async () => {
    const f = await seedFranchise(t.sql, "Franquia Item");
    const e = await quarantined("Item Principal", { franchiseId: f, favorites: 7 });
    const other = await seedEntity(t.sql, "Item Existente");
    const id = await seedModeration(t.sql, { entityId: e, otherEntityId: other, reason: "DUPLICATE_SUSPECT" });
    await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const item = await review.getQueueItem(db, id);
    expect(item).toMatchObject({
      id,
      reason: "DUPLICATE_SUSPECT",
      kind: "duplicate",
      status: "PENDING",
      siblingReasons: ["LOW_FAVORITES"],
    });
    expect(item!.entity).toMatchObject({ id: e, name: "Item Principal", franchise: "Franquia Item", sourceFavorites: 7 });
    expect(item!.entity!.imageUrl).toContain("https://x/");
    expect(item!.other!.id).toBe(other);
    expect(await review.getQueueItem(db, 999_999)).toBeNull();
  });
});

describe("aprovar", () => {
  it("dispensa o motivo (revisor humano), ativa a entidade e a dispensa vale nas proximas syncs", async () => {
    const e = await quarantined("Aprova Simples");
    const id = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const out = await review.approveItem(db, id, MOD);
    expect(out).toMatchObject({ ok: true, action: "approved", entityId: e, status: "ACTIVE", activated: true, disabled: false });
    expect(await rowOf(id)).toMatchObject({ status: "APPROVED", reviewed_by: MOD });
    expect((await entityRow(e)).status).toBe("ACTIVE");
    expect((await loadWaivers(db, e)).reasons.has("LOW_FAVORITES")).toBe(true);
    const rev = await one<any>(t.sql`SELECT changed_by, reason, source FROM entity_revisions WHERE entity_id = ${e}`);
    expect(rev).toEqual({ changed_by: MOD, reason: "moderation", source: "MANUAL" });
  });

  it("so ativa quando nao sobra pendencia aberta", async () => {
    const e = await quarantined("Aprova Dupla");
    const a = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const b = await seedModeration(t.sql, { entityId: e, reason: "ADULT_CONTENT" });
    const first = await review.approveItem(db, a, MOD);
    expect(first).toMatchObject({ ok: true, status: "QUARANTINED", activated: false });
    const second = await review.approveItem(db, b, MOD);
    expect(second).toMatchObject({ ok: true, status: "ACTIVE", activated: true });
  });

  it("UNKNOWN_GENDER sem genero e NO_IMAGE sem imagem sao bloqueados", async () => {
    const g = await quarantined("Sem Genero", { gender: "UNKNOWN" });
    const gid = await seedModeration(t.sql, { entityId: g, reason: "UNKNOWN_GENDER" });
    expect(await review.approveItem(db, gid, MOD)).toEqual({ ok: false, code: "blocked_gender" });
    expect((await rowOf(gid)).status).toBe("PENDING");

    const i = await quarantined("Sem Imagem", { image: false });
    const iid = await seedModeration(t.sql, { entityId: i, reason: "NO_IMAGE" });
    expect(await review.approveItem(db, iid, MOD)).toEqual({ ok: false, code: "blocked_image" });
    await t.sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${i}, 'https://x/img.png', true)`;
    expect(await review.approveItem(db, iid, MOD)).toMatchObject({ ok: true, status: "ACTIVE" });
  });

  it("5 aprovacoes concorrentes do mesmo item: exatamente uma vale", async () => {
    const e = await quarantined("Concorrente");
    const id = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => review.approveItem(db, id, `mod-${i}`)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok && r.code === "stale")).toHaveLength(4);
  });

  it("item ja fechado vira stale e revisor 'system' e recusado", async () => {
    const e = await quarantined("Fechado");
    const id = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    await review.approveItem(db, id, MOD);
    expect(await review.approveItem(db, id, MOD)).toEqual({ ok: false, code: "stale" });
    expect(await review.rejectItem(db, id, MOD)).toEqual({ ok: false, code: "stale" });
    expect(await review.approveItem(db, 888_888, MOD)).toEqual({ ok: false, code: "stale" });
    const e2 = await quarantined("Sistema");
    const id2 = await seedModeration(t.sql, { entityId: e2, reason: "LOW_FAVORITES" });
    await expect(review.approveItem(db, id2, "system")).rejects.toThrow(/humano/);
    expect((await rowOf(id2)).status).toBe("PENDING");
  });

  it("item sem entidade (OTHER) so fecha a linha", async () => {
    const id = await seedModeration(t.sql, { entityId: null, reason: "OTHER" });
    expect(await review.approveItem(db, id, MOD)).toMatchObject({ ok: true, entityId: null, status: null });
    expect(await rowOf(id)).toMatchObject({ status: "APPROVED", reviewed_by: MOD });
  });
});

describe("rejeitar", () => {
  it("motivo comum: REJECTED, entidade DESATIVADA e demais pendencias dela fechadas", async () => {
    const e = await quarantined("Rejeita Comum");
    const a = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const b = await seedModeration(t.sql, { entityId: e, reason: "REAL_PERSON" });
    const out = await review.rejectItem(db, a, MOD);
    expect(out).toMatchObject({ ok: true, action: "rejected", status: "DISABLED", disabled: true });
    expect(await rowOf(a)).toMatchObject({ status: "REJECTED", reviewed_by: MOD });
    expect(await rowOf(b)).toMatchObject({ status: "REJECTED", reviewed_by: MOD });
    expect((await entityRow(e)).status).toBe("DISABLED");
  });

  it("denuncia de usuario: rejeitar descarta e mantem a entidade; aprovar desativa", async () => {
    const keep = await seedEntity(t.sql, "Denuncia Falsa");
    const kid = await seedModeration(t.sql, { entityId: keep, reason: "USER_REPORT" });
    expect(await review.rejectItem(db, kid, MOD)).toMatchObject({ ok: true, action: "dismissed", status: "ACTIVE", disabled: false });
    expect((await entityRow(keep)).status).toBe("ACTIVE");

    const gone = await seedEntity(t.sql, "Denuncia Valida");
    const gid = await seedModeration(t.sql, { entityId: gone, reason: "TAKEDOWN" });
    expect(await review.approveItem(db, gid, MOD)).toMatchObject({ ok: true, status: "DISABLED", disabled: true });
    expect((await entityRow(gone)).status).toBe("DISABLED");
  });
});

describe("duplicatas", () => {
  it("aprovar = confirmar duplicata: a existente absorve a nova (pactos movidos, linhas fechadas)", async () => {
    const winner = await seedEntity(t.sql, "Dup Existente");
    const loser = await seedEntity(t.sql, "Dup Nova", { status: "PENDING_REVIEW" });
    const g = uid("g");
    const pact = await seedPact(t.sql, g, uid("u"), loser);
    const id = await seedModeration(t.sql, { entityId: loser, otherEntityId: winner, reason: "DUPLICATE_SUSPECT" });

    const out = await review.approveItem(db, id, MOD);
    expect(out).toMatchObject({ ok: true, action: "merged", entityId: winner, name: "Dup Nova", winnerName: "Dup Existente" });
    expect(await entityRow(loser)).toMatchObject({ status: "MERGED", merged: winner });
    expect((await one<any>(t.sql`SELECT entity_id::int AS e FROM pacts WHERE id = ${pact}`)).e).toBe(winner);
    expect(await rowOf(id)).toMatchObject({ status: "APPROVED", reviewed_by: MOD });
  });

  it("rejeitar = 'nao e duplicata': REJECTED, ambas ficam e a nova ativa", async () => {
    const winner = await seedEntity(t.sql, "Par Existente");
    const other = await seedEntity(t.sql, "Par Novo", { status: "PENDING_REVIEW" });
    const id = await seedModeration(t.sql, { entityId: other, otherEntityId: winner, reason: "DUPLICATE_SUSPECT" });
    const out = await review.rejectItem(db, id, MOD);
    expect(out).toMatchObject({ ok: true, action: "not_duplicate", status: "ACTIVE", activated: true });
    expect(await rowOf(id)).toMatchObject({ status: "REJECTED", reviewed_by: MOD });
    expect((await loadWaivers(db, other)).notDuplicateOf.has(winner)).toBe(true);
    expect((await entityRow(winner)).status).toBe("ACTIVE");
  });

  it("merge impossivel (existente ja mesclada) devolve merge_failed sem alterar a fila", async () => {
    const a = await seedEntity(t.sql, "Mesclada A", { status: "MERGED" });
    const b = await seedEntity(t.sql, "Nova B", { status: "PENDING_REVIEW" });
    const id = await seedModeration(t.sql, { entityId: b, otherEntityId: a, reason: "DUPLICATE_SUSPECT" });
    const out = await review.approveItem(db, id, MOD);
    expect(out).toMatchObject({ ok: false, code: "merge_failed" });
    expect((await rowOf(id)).status).toBe("PENDING");
  });
});

describe("genero e nome", () => {
  it("setItemGender corrige o genero, fecha os motivos de genero e ativa", async () => {
    const e = await quarantined("Define Genero", { gender: "UNKNOWN" });
    const a = await seedModeration(t.sql, { entityId: e, reason: "UNKNOWN_GENDER" });
    const out = await review.setItemGender(db, a, "FEMALE", MOD);
    expect(out).toMatchObject({ ok: true, action: "gender", gender: "FEMALE", status: "ACTIVE", activated: true });
    expect((await entityRow(e)).gender).toBe("FEMALE");
    expect(await rowOf(a)).toMatchObject({ status: "APPROVED", reviewed_by: MOD });
  });

  it("outro motivo pendente segura a ativacao; genero invalido e item sem entidade falham", async () => {
    const e = await quarantined("Genero Parcial", { gender: "UNKNOWN" });
    const g = await seedModeration(t.sql, { entityId: e, reason: "UNKNOWN_GENDER" });
    const l = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    expect(await review.setItemGender(db, g, "MALE", MOD)).toMatchObject({ ok: true, status: "QUARANTINED", activated: false });
    expect((await rowOf(l)).status).toBe("PENDING");

    expect(await review.setItemGender(db, l, "UNKNOWN", MOD)).toEqual({ ok: false, code: "invalid_gender" });
    expect(await review.setItemGender(db, l, "BOTH", MOD)).toEqual({ ok: false, code: "invalid_gender" });
    const orphan = await seedModeration(t.sql, { entityId: null, reason: "OTHER" });
    expect(await review.setItemGender(db, orphan, "MALE", MOD)).toEqual({ ok: false, code: "no_entity" });
  });

  it("renameItemEntity normaliza, recalcula a chave de dedupe e fecha INVALID_NAME", async () => {
    const e = await quarantined("x");
    const id = await seedModeration(t.sql, { entityId: e, reason: "INVALID_NAME" });
    const out = await review.renameItemEntity(db, id, "  Killua   Zoldyck ", MOD);
    expect(out).toMatchObject({ ok: true, action: "renamed", name: "Killua Zoldyck", status: "ACTIVE" });
    expect(await entityRow(e)).toMatchObject({ name: "Killua Zoldyck", name_normalized: "killua zoldyck", status: "ACTIVE" });
    expect(await rowOf(id)).toMatchObject({ status: "APPROVED", reviewed_by: MOD });
  });

  it("nome fora de 2..64 caracteres nao altera nada", async () => {
    const e = await quarantined("y");
    const id = await seedModeration(t.sql, { entityId: e, reason: "INVALID_NAME" });
    for (const bad of ["a", "   ", "z".repeat(65)]) {
      expect(await review.renameItemEntity(db, id, bad, MOD)).toEqual({ ok: false, code: "invalid_name" });
    }
    expect((await entityRow(e)).name).toBe("y");
    expect((await rowOf(id)).status).toBe("PENDING");
    expect(review.cleanEntityName("ab")).toBe("ab");
    expect(review.cleanEntityName("z".repeat(64))).toHaveLength(64);
  });
});

describe("merge manual", () => {
  it("previewMerge/mergeCatalogEntities: id1 permanece, id2 e mesclado", async () => {
    const w = await seedEntity(t.sql, "Merge Fica");
    const l = await seedEntity(t.sql, "Merge Sai");
    const pact = await seedPact(t.sql, uid("g"), uid("u"), l);
    expect(await svc.previewMerge(db, w, l)).toEqual({
      ok: true,
      winner: { id: w, name: "Merge Fica" },
      loser: { id: l, name: "Merge Sai" },
    });
    const out = await svc.mergeCatalogEntities(db, w, l, MOD);
    expect(out).toMatchObject({ ok: true, winner: { id: w }, loser: { id: l } });
    if (out.ok) expect(out.result.pactsMoved).toBe(1);
    expect(await entityRow(l)).toMatchObject({ status: "MERGED", merged: w });
    expect((await one<any>(t.sql`SELECT entity_id::int AS e FROM pacts WHERE id = ${pact}`)).e).toBe(w);
    const rev = await one<any>(t.sql`SELECT changed_by, reason FROM entity_revisions WHERE entity_id = ${w}`);
    expect(rev).toEqual({ changed_by: MOD, reason: "manual_merge" });
  });

  it("erros: inexistente, mesma entidade e ja mesclada", async () => {
    const a = await seedEntity(t.sql, "Merge Erro A");
    const b = await seedEntity(t.sql, "Merge Erro B");
    expect(await svc.mergeCatalogEntities(db, a, 987_654, MOD)).toEqual({ ok: false, code: "not_found", id: 987_654 });
    expect(await svc.mergeCatalogEntities(db, 987_654, a, MOD)).toEqual({ ok: false, code: "not_found", id: 987_654 });
    expect(await svc.mergeCatalogEntities(db, a, a, MOD)).toMatchObject({ ok: false, code: "failed" });
    await svc.mergeCatalogEntities(db, a, b, MOD);
    expect(await svc.mergeCatalogEntities(db, a, b, MOD)).toMatchObject({ ok: false, code: "failed" });
  });
});

describe("painel ponta a ponta (handler cr + banco real)", () => {
  const textOf = (p: any) =>
    [p?.content, ...(p?.embeds ?? []).map((e: any) => [e.toJSON().title, e.toJSON().description, e.toJSON().footer?.text].join("\n"))].join("\n");

  function interaction(kind: "button" | "select", customId: string, userId: string, extra: Record<string, unknown> = {}) {
    return {
      customId,
      user: { id: userId },
      locale: "pt-BR",
      isButton: () => kind === "button",
      isStringSelectMenu: () => kind === "select",
      isModalSubmit: () => false,
      reply: vi.fn(async () => undefined),
      deferUpdate: vi.fn(async () => undefined),
      editReply: vi.fn(async (_: unknown) => undefined),
      showModal: vi.fn(async () => undefined),
      ...extra,
    } as any;
  }

  const notified: string[] = [];
  const make = () =>
    components.createReviewHandler({
      getDb: () => db,
      ownerCheck: (id) => id === "boss",
      notify: async (s) => {
        notified.push(s);
      },
    });

  it("abre na primeira pendencia; aprovar ativa (Eter provisorio), avisa o pool e mostra a proxima", async () => {
    const e1 = await quarantined("Painel Um", { favorites: 50 });
    const e2 = await quarantined("Painel Dois");
    const i1 = await seedModeration(t.sql, { entityId: e1, reason: "LOW_FAVORITES" });
    const i2 = await seedModeration(t.sql, { entityId: e2, reason: "ADULT_CONTENT" });

    const open = await components.renderReview(db, "pt-BR", null);
    expect(textOf(open)).toContain(`Fila #${i1} • item 1 de 2`);

    const handler = make();
    const click = interaction("button", `cr:ok:${i1}`, "boss");
    await handler.handle(click, ["ok", String(i1)]);
    expect((await entityRow(e1)).status).toBe("ACTIVE");
    expect(await rowOf(i1)).toMatchObject({ status: "APPROVED", reviewed_by: "boss" });
    const view = click.editReply.mock.calls[0][0];
    expect(view.content).toContain("foi ativado no catálogo");
    expect(textOf(view)).toContain(`Fila #${i2} • item 1 de 1`);
    expect(notified).toContain("review");
    expect((await one<any>(t.sql`SELECT base_aether AS a FROM entities WHERE id = ${e1}`)).a).toBeGreaterThanOrEqual(40);
  });

  it("quem nao e moderador nao altera nada", async () => {
    const e = await quarantined("Painel Intruso");
    const id = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const click = interaction("button", `cr:no:${id}`, "intruso");
    await make().handle(click, ["no", String(id)]);
    expect(click.reply).toHaveBeenCalledTimes(1);
    expect((await rowOf(id)).status).toBe("PENDING");
    expect((await entityRow(e)).status).toBe("QUARANTINED");
  });

  it("moderador cadastrado em catalog_moderators rejeita (desativa) e a fila esvazia", async () => {
    const mod = uid("m");
    await t.sql`INSERT INTO catalog_moderators (user_id) VALUES (${mod})`;
    const e = await quarantined("Painel Rejeita");
    const id = await seedModeration(t.sql, { entityId: e, reason: "LOW_FAVORITES" });
    const click = interaction("button", `cr:no:${id}`, mod);
    await make().handle(click, ["no", String(id)]);
    expect((await entityRow(e)).status).toBe("DISABLED");
    const view = click.editReply.mock.calls[0][0];
    expect(view.content).toContain("foi desativado");
    expect(textOf(view)).toContain("fila de moderação está vazia");
  });

  it("select de genero corrige e ativa; bloqueio de aprovar mantem o item", async () => {
    const e = await quarantined("Painel Genero", { gender: "UNKNOWN" });
    const id = await seedModeration(t.sql, { entityId: e, reason: "UNKNOWN_GENDER" });
    const handler = make();

    const blocked = interaction("button", `cr:ok:${id}`, "boss");
    await handler.handle(blocked, ["ok", String(id)]);
    expect(blocked.editReply.mock.calls[0][0].content).toContain("Defina o gênero");
    expect(textOf(blocked.editReply.mock.calls[0][0])).toContain(`Fila #${id}`);

    const pick = interaction("select", `cr:gn:${id}`, "boss", { values: ["NONBINARY"] });
    await handler.handle(pick, ["gn", String(id)]);
    expect(await entityRow(e)).toMatchObject({ gender: "NONBINARY", status: "ACTIVE" });
  });
});
