import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/modules/catalog/review.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/catalog/review.js")>()),
  isCatalogModerator: vi.fn(),
  getQueueItem: vi.fn(),
  neighborPendingId: vi.fn(),
  firstPendingId: vi.fn(),
  queueCounts: vi.fn(async () => ({ total: 4, position: 2 })),
  approveItem: vi.fn(),
  rejectItem: vi.fn(),
  setItemGender: vi.fn(),
  renameItemEntity: vi.fn(),
}));
vi.mock("../../../src/modules/catalog/service.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/catalog/service.js")>()),
  applyProvisionalAether: vi.fn(async () => 321),
  notifyCatalogUpdated: vi.fn(async () => undefined),
}));

import type { QueueItem } from "../../../src/modules/catalog/review.js";
import * as review from "../../../src/modules/catalog/review.js";
import * as svc from "../../../src/modules/catalog/service.js";
import { createReviewHandler, renderReview } from "../../../src/modules/catalog/components.js";
import { textOf } from "./helpers.js";

const NOW = new Date("2026-03-01T12:00:00Z");
const DB = { fake: "db" } as never;

const item = (id: number, over: Partial<QueueItem> = {}): QueueItem => ({
  id,
  reason: "LOW_FAVORITES",
  kind: "waive",
  status: "PENDING",
  details: {},
  createdAt: NOW,
  entity: {
    id: 100 + id,
    name: `Char ${id}`,
    nameNative: null,
    gender: "MALE",
    status: "QUARANTINED",
    isAdult: false,
    sourceFavorites: 4,
    franchise: "Franchise",
    seriesTitle: null,
    imageUrl: null,
  },
  other: null,
  siblingReasons: [],
  ...over,
});

const okOutcome = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  action: "approved" as const,
  entityId: 112,
  entityName: "Char 12",
  status: "QUARANTINED" as const,
  activated: false,
  disabled: false,
  ...over,
});

function interaction(
  kind: "button" | "select" | "modal",
  customId: string,
  extra: Record<string, unknown> = {},
  userId = "mod1"
) {
  const base = {
    customId,
    user: { id: userId },
    locale: "pt-BR",
    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "select",
    isModalSubmit: () => kind === "modal",
    reply: vi.fn(async () => undefined),
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    showModal: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    ...extra,
  };
  return base as any;
}

const notify = vi.fn(async () => undefined);
const handler = createReviewHandler({
  getDb: () => DB,
  ownerCheck: (id) => id === "owner1",
  now: () => NOW,
  notify,
});
const run = (i: any, ...parts: string[]) => handler.handle(i, parts);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(review.isCatalogModerator).mockResolvedValue(true);
  vi.mocked(review.queueCounts).mockResolvedValue({ total: 4, position: 2 });
});

describe("handler cr", () => {
  it("usa o namespace cr", () => {
    expect(handler.namespace).toBe("cr");
  });

  it("nao-moderador recebe erro ephemeral e nada e executado", async () => {
    vi.mocked(review.isCatalogModerator).mockResolvedValue(false);
    const i = interaction("button", "cr:ok:12", {}, "intruso");
    await run(i, "ok", "12");
    expect(review.isCatalogModerator).toHaveBeenCalledWith(DB, "intruso", expect.any(Function));
    expect(i.reply).toHaveBeenCalledTimes(1);
    const payload = (i.reply.mock.calls[0] as unknown[])[0] as any;
    expect(payload.ephemeral).toBe(true);
    expect(textOf(payload)).toContain("autorização");
    expect(review.approveItem).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it("customId invalido e ignorado", async () => {
    const i = interaction("button", "cr:zz:12");
    await run(i, "zz", "12");
    await run(i, "ok", "abc");
    expect(review.isCatalogModerator).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it("Aprovar: registra o revisor humano e mostra o proximo item da fila", async () => {
    vi.mocked(review.approveItem).mockResolvedValue(okOutcome() as never);
    vi.mocked(review.getQueueItem).mockImplementation(async (_db, id) =>
      id === 12 ? item(12, { status: "APPROVED" }) : id === 13 ? item(13) : null
    );
    vi.mocked(review.neighborPendingId).mockResolvedValue(13);
    const i = interaction("button", "cr:ok:12", {}, "owner1");
    await run(i, "ok", "12");
    expect(i.deferUpdate).toHaveBeenCalledTimes(1);
    expect(review.approveItem).toHaveBeenCalledWith(DB, 12, "owner1", { now: NOW });
    expect(review.neighborPendingId).toHaveBeenCalledWith(DB, 12, "next");
    const view = (i.editReply.mock.calls[0] as unknown[])[0] as any;
    expect(view.content).toBe("✅ Item #12 aprovado.");
    expect(textOf(view)).toContain("Fila #13");
    expect(notify).not.toHaveBeenCalled();
  });

  it("Aprovar que ativa a entidade: Eter provisorio e aviso ao pool", async () => {
    vi.mocked(review.approveItem).mockResolvedValue(okOutcome({ activated: true, status: "ACTIVE" }) as never);
    vi.mocked(review.getQueueItem).mockResolvedValue(null);
    vi.mocked(review.neighborPendingId).mockResolvedValue(null);
    const i = interaction("button", "cr:ok:12");
    await run(i, "ok", "12");
    expect(svc.applyProvisionalAether).toHaveBeenCalledWith(DB, 112);
    expect(notify).toHaveBeenCalledWith("review");
    const view = (i.editReply.mock.calls[0] as unknown[])[0] as any;
    expect(view.content).toContain("foi ativado no catálogo");
    expect(textOf(view)).toContain("fila de moderação está vazia");
    expect(view.components).toEqual([]);
  });

  it("Rejeitar: chama rejectItem e avisa desativacao", async () => {
    vi.mocked(review.rejectItem).mockResolvedValue(
      okOutcome({ action: "rejected", disabled: true, status: "DISABLED" }) as never
    );
    vi.mocked(review.getQueueItem).mockResolvedValue(null);
    vi.mocked(review.neighborPendingId).mockResolvedValue(null);
    const i = interaction("button", "cr:no:12");
    await run(i, "no", "12");
    expect(review.rejectItem).toHaveBeenCalledWith(DB, 12, "mod1", { now: NOW });
    expect(((i.editReply.mock.calls[0] as unknown[])[0] as any).content).toContain("foi desativado");
    expect(notify).toHaveBeenCalledWith("review");
  });

  it("Aprovar bloqueado (genero): continua no mesmo item com o aviso", async () => {
    vi.mocked(review.approveItem).mockResolvedValue({ ok: false, code: "blocked_gender" });
    vi.mocked(review.getQueueItem).mockImplementation(async (_db, id) =>
      id === 12 ? item(12, { reason: "UNKNOWN_GENDER" }) : null
    );
    const i = interaction("button", "cr:ok:12");
    await run(i, "ok", "12");
    const view = (i.editReply.mock.calls[0] as unknown[])[0] as any;
    expect(view.content).toContain("Defina o gênero");
    expect(textOf(view)).toContain("Fila #12");
    expect(review.neighborPendingId).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("item ja processado por outro moderador: aviso e segue para o proximo", async () => {
    vi.mocked(review.rejectItem).mockResolvedValue({ ok: false, code: "stale" });
    vi.mocked(review.getQueueItem).mockImplementation(async (_db, id) =>
      id === 12 ? item(12, { status: "REJECTED" }) : id === 20 ? item(20) : null
    );
    vi.mocked(review.neighborPendingId).mockResolvedValue(20);
    const i = interaction("button", "cr:no:12");
    await run(i, "no", "12");
    const view = (i.editReply.mock.calls[0] as unknown[])[0] as any;
    expect(view.content).toContain("já foi processado");
    expect(textOf(view)).toContain("Fila #20");
  });

  it("Corrigir nome abre o modal sem defer; item inexistente cai no aviso", async () => {
    vi.mocked(review.getQueueItem).mockResolvedValue(item(12));
    const i = interaction("button", "cr:nm:12");
    await run(i, "nm", "12");
    expect(i.deferUpdate).not.toHaveBeenCalled();
    const modal = (i.showModal.mock.calls[0] as unknown[])[0] as any;
    expect(modal.toJSON().custom_id).toBe("cr:nmm:12");
    expect((modal.toJSON().components[0].components[0] as any).value).toBe("Char 12");

    vi.mocked(review.getQueueItem).mockResolvedValue(null);
    vi.mocked(review.neighborPendingId).mockResolvedValue(null);
    const j = interaction("button", "cr:nm:99");
    await run(j, "nm", "99");
    expect(j.showModal).not.toHaveBeenCalled();
    expect(j.deferUpdate).toHaveBeenCalled();
  });

  it("envio do modal renomeia pela regra do pipeline", async () => {
    vi.mocked(review.renameItemEntity).mockResolvedValue(
      okOutcome({ action: "renamed", name: "Killua Zoldyck", entityName: "Killua Zoldyck" }) as never
    );
    vi.mocked(review.getQueueItem).mockResolvedValue(item(12));
    const i = interaction("modal", "cr:nmm:12", {
      fields: { getTextInputValue: vi.fn(() => "Killua Zoldyck") },
    });
    await run(i, "nmm", "12");
    expect(review.renameItemEntity).toHaveBeenCalledWith(DB, 12, "Killua Zoldyck", "mod1", { now: NOW });
    expect(((i.editReply.mock.calls[0] as unknown[])[0] as any).content).toContain("Killua Zoldyck");
  });

  it("nome invalido mostra o aviso e mantem o item", async () => {
    vi.mocked(review.renameItemEntity).mockResolvedValue({ ok: false, code: "invalid_name" });
    vi.mocked(review.getQueueItem).mockResolvedValue(item(12));
    const i = interaction("modal", "cr:nmm:12", { fields: { getTextInputValue: () => "x" } });
    await run(i, "nmm", "12");
    expect(((i.editReply.mock.calls[0] as unknown[])[0] as any).content).toContain("Nome inválido");
  });

  it("select de genero aplica o primeiro valor", async () => {
    vi.mocked(review.setItemGender).mockResolvedValue(
      okOutcome({ action: "gender", gender: "FEMALE", activated: true, status: "ACTIVE" }) as never
    );
    vi.mocked(review.getQueueItem).mockResolvedValue(null);
    vi.mocked(review.neighborPendingId).mockResolvedValue(null);
    const i = interaction("select", "cr:gn:12", { values: ["FEMALE"] });
    await run(i, "gn", "12");
    expect(review.setItemGender).toHaveBeenCalledWith(DB, 12, "FEMALE", "mod1", { now: NOW });
    expect(svc.applyProvisionalAether).toHaveBeenCalled();
    expect(((i.editReply.mock.calls[0] as unknown[])[0] as any).content).toContain("Feminino");
  });

  it("navegacao anterior/proxima usa os vizinhos pendentes (com volta)", async () => {
    vi.mocked(review.neighborPendingId).mockResolvedValue(30);
    vi.mocked(review.getQueueItem).mockResolvedValue(item(30));
    const i = interaction("button", "cr:next:12");
    await run(i, "next", "12");
    await run(interaction("button", "cr:prev:12"), "prev", "12");
    expect(vi.mocked(review.neighborPendingId).mock.calls.map((c) => c[2])).toEqual(["next", "prev"]);
    expect(textOf((i.editReply.mock.calls[0] as unknown[])[0])).toContain("Fila #30");
  });

  it("tipo de interacao incompativel com a acao e ignorado", async () => {
    const i = interaction("button", "cr:gn:12");
    await run(i, "gn", "12");
    const j = interaction("select", "cr:ok:12", { values: ["x"] });
    await run(j, "ok", "12");
    expect(review.setItemGender).not.toHaveBeenCalled();
    expect(review.approveItem).not.toHaveBeenCalled();
  });
});

describe("renderReview", () => {
  it("sem foco abre o primeiro pendente; fila vazia devolve a view vazia", async () => {
    vi.mocked(review.firstPendingId).mockResolvedValueOnce(5);
    vi.mocked(review.getQueueItem).mockResolvedValueOnce(item(5));
    const view = await renderReview(DB, "pt-BR", null);
    expect(textOf(view)).toContain("Fila #5");
    expect(view.components.length).toBeGreaterThan(0);

    vi.mocked(review.firstPendingId).mockResolvedValueOnce(null);
    const empty = await renderReview(DB, "pt-BR", null, "fim");
    expect(empty.components).toEqual([]);
    expect(empty.content).toBe("fim");
  });
});
