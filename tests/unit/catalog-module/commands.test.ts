import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/infra/redis/client.js", async () => {
  const { FakeKV } = await import("../ui/helpers.js");
  const kv = new FakeKV();
  return { getKV: vi.fn(async () => kv), closeKV: vi.fn(async () => undefined) };
});
vi.mock("../../../src/modules/catalog/review.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/catalog/review.js")>()),
  isCatalogModerator: vi.fn(),
}));
vi.mock("../../../src/modules/catalog/components.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/catalog/components.js")>()),
  renderReview: vi.fn(async () => ({ embeds: [], components: [] })),
}));
vi.mock("../../../src/modules/catalog/service.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/catalog/service.js")>()),
  resolveImportRole: vi.fn(),
  claimVipImport: vi.fn(),
  refundVipImport: vi.fn(async () => undefined),
  importCharacter: vi.fn(),
  createSuggestion: vi.fn(),
  listPendingSuggestions: vi.fn(),
  findPendingSuggestion: vi.fn(),
  claimSuggestion: vi.fn(),
  releaseSuggestion: vi.fn(async () => undefined),
  resolveSuggestion: vi.fn(async () => undefined),
  notifyCatalogUpdated: vi.fn(async () => undefined),
  previewMerge: vi.fn(),
  mergeCatalogEntities: vi.fn(),
}));
vi.mock("../../../src/modules/catalog/anilist.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/catalog/anilist.js")>()),
  AniListCharacterFinder: class {
    find = vi.fn();
  },
}));
vi.mock("../../../src/ui/components/confirm.js", () => ({ confirm: vi.fn() }));

import { CommandRegistry } from "../../../src/core/registry.js";
import { UserError } from "../../../src/lib/errors.js";
import { CatalogApiError } from "../../../src/modules/catalog/anilist.js";
import {
  approveSuggestCommand,
  catalogCommand,
  catalogCommands,
  importCommand,
  suggestCommand,
  suggestListCommand,
} from "../../../src/modules/catalog/commands.js";
import { renderReview } from "../../../src/modules/catalog/components.js";
import { commands, components } from "../../../src/modules/catalog/index.js";
import { isCatalogModerator } from "../../../src/modules/catalog/review.js";
import * as svc from "../../../src/modules/catalog/service.js";
import { confirm } from "../../../src/ui/components/confirm.js";
import { makeCtx, textOf } from "./helpers.js";

const imported = (over: Record<string, unknown> = {}) => ({
  kind: "imported" as const,
  created: true,
  activated: false,
  anilistId: 27,
  entity: {
    id: 7,
    name: "Killua Zoldyck",
    franchise: "Hunter x Hunter",
    seriesTitle: "Hunter x Hunter (2011)",
    status: "ACTIVE" as const,
    gender: "MALE",
    aether: 612,
    imageUrl: null,
    pendingReasons: [],
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registro do modulo", () => {
  it("exporta commands/components e registra sem colisao no registry", () => {
    expect(commands.map((c) => c.name)).toEqual([
      "import",
      "suggest",
      "suggestlist",
      "approvesuggest",
      "catalog",
    ]);
    expect(components.map((c) => c.namespace)).toEqual(["cr"]);
    const registry = new CommandRegistry();
    for (const cmd of catalogCommands) registry.register(cmd);
    for (const alias of ["add", "importar", "sugerir", "sugestoes", "aprovar"]) {
      expect(registry.get(alias), alias).toBeDefined();
    }
    expect(registry.get("add")?.name).toBe("import");
    expect(registry.get("aprovar")?.name).toBe("approvesuggest");
  });

  it("todos tem categoria catalog, descricao e slash", () => {
    for (const cmd of catalogCommands) {
      expect(cmd.category).toBe("catalog");
      expect(cmd.descriptionKey).toMatch(/^help\.commands\./);
      expect(cmd.slash).toBeTypeOf("function");
    }
  });

  it("gera o payload slash: /import e /suggest com opcao name, /catalog com review e merge", () => {
    const registry = new CommandRegistry();
    for (const cmd of catalogCommands) registry.register(cmd);
    const payload = registry.buildSlashPayload();
    expect(payload.map((p) => p.name).sort()).toEqual(
      ["approvesuggest", "catalog", "import", "suggest", "suggestlist"].sort()
    );
    const byName = Object.fromEntries(payload.map((p) => [p.name, p]));
    expect((byName.import.options as any[]).map((o) => [o.name, o.required])).toEqual([["name", true]]);
    expect((byName.suggest.options as any[])[0].max_length).toBe(100);
    const sub = (byName.catalog.options as any[]).map((o) => o.name);
    expect(sub).toEqual(["review", "merge"]);
    const merge = (byName.catalog.options as any[])[1];
    expect(merge.options.map((o: any) => [o.name, o.min_value, o.required])).toEqual([
      ["id1", 1, true],
      ["id2", 1, true],
    ]);
    // descricao pt-BR vem do locale, en-US localizada
    expect(byName.import.description).toBe("Importa um personagem do multiverso para o catálogo.");
    expect((byName.import.description_localizations as any)["en-US"]).toContain("Imports a character");
  });
});

describe("$import", () => {
  it("sem nome: mostra o uso", async () => {
    const { ctx, sent } = makeCtx({ args: { query: "   " } });
    await importCommand.execute(ctx);
    expect(textOf(sent[0])).toContain("Digite o nome do personagem");
    expect(svc.resolveImportRole).not.toHaveBeenCalled();
  });

  it("nega quem nao e owner nem VIP e sugere $suggest", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("denied");
    const { ctx, sent } = makeCtx({ args: { query: "Killua" } });
    await importCommand.execute(ctx);
    expect(textOf(sent[0])).toContain("Acesso Restrito");
    expect(textOf(sent[0])).toContain("`$suggest Killua`");
    expect(svc.claimVipImport).not.toHaveBeenCalled();
    expect(svc.importCharacter).not.toHaveBeenCalled();
  });

  it("VIP que estourou a cota diaria (2/dia) e barrado antes de chamar o AniList", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("vip");
    vi.mocked(svc.claimVipImport).mockResolvedValue({ ok: false });
    const { ctx, sent } = makeCtx({ args: { query: "Killua" } });
    await importCommand.execute(ctx);
    expect(textOf(sent[0])).toContain("Limite Diário VIP Atingido (2/2)");
    expect(svc.importCharacter).not.toHaveBeenCalled();
    expect(svc.refundVipImport).not.toHaveBeenCalled();
  });

  it("VIP importa: consome cota, nao e owner, e a cota nao e devolvida", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("vip");
    vi.mocked(svc.claimVipImport).mockResolvedValue({ ok: true, used: 1 });
    vi.mocked(svc.importCharacter).mockResolvedValue(imported());
    const { ctx, sent } = makeCtx({ args: { query: "Killua" } });
    await importCommand.execute(ctx);
    expect(svc.claimVipImport).toHaveBeenCalledTimes(1);
    expect(vi.mocked(svc.importCharacter).mock.calls[0][0]).toBe("Killua");
    expect(vi.mocked(svc.importCharacter).mock.calls[0][1].actor).toEqual({ id: "u1", isOwner: false });
    expect(svc.refundVipImport).not.toHaveBeenCalled();
    expect(svc.notifyCatalogUpdated).toHaveBeenCalledWith("import");
    expect(textOf(sent.at(-1))).toContain("Killua Zoldyck");
    expect(textOf(sent.at(-1))).toContain("612");
  });

  it("VIP: nao achou no AniList -> cota devolvida", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("vip");
    vi.mocked(svc.claimVipImport).mockResolvedValue({ ok: true, used: 1 });
    vi.mocked(svc.importCharacter).mockResolvedValue({ kind: "not_found" });
    const { ctx, sent } = makeCtx({ args: { query: "Zzzz" } });
    await importCommand.execute(ctx);
    expect(textOf(sent.at(-1))).toContain("Nenhum personagem encontrado");
    expect(svc.refundVipImport).toHaveBeenCalledTimes(1);
  });

  it("VIP: personagem ja existente nao gasta cota", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("vip");
    vi.mocked(svc.claimVipImport).mockResolvedValue({ ok: true, used: 2 });
    vi.mocked(svc.importCharacter).mockResolvedValue({
      kind: "exists",
      anilistId: 27,
      entity: imported().entity,
    });
    const { ctx, sent } = makeCtx({ args: { query: "Killua" } });
    await importCommand.execute(ctx);
    expect(textOf(sent.at(-1))).toContain("já está no catálogo");
    expect(svc.refundVipImport).toHaveBeenCalledTimes(1);
  });

  it("falha do AniList: mensagem propria e cota devolvida", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("vip");
    vi.mocked(svc.claimVipImport).mockResolvedValue({ ok: true, used: 1 });
    vi.mocked(svc.importCharacter).mockRejectedValue(new CatalogApiError("down"));
    const { ctx, sent } = makeCtx({ args: { query: "Killua" } });
    await importCommand.execute(ctx);
    expect(textOf(sent.at(-1))).toContain("Erro ao sincronizar com o multiverso");
    expect(svc.refundVipImport).toHaveBeenCalledTimes(1);
  });

  it("erro inesperado: devolve a cota e propaga para o errorBoundary (errorId)", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("vip");
    vi.mocked(svc.claimVipImport).mockResolvedValue({ ok: true, used: 1 });
    vi.mocked(svc.importCharacter).mockRejectedValue(new Error("boom"));
    const { ctx } = makeCtx({ args: { query: "Killua" } });
    await expect(importCommand.execute(ctx)).rejects.toThrow("boom");
    expect(svc.refundVipImport).toHaveBeenCalledTimes(1);
  });

  it("owner importa sem cota e pode ativar direto", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("owner");
    vi.mocked(svc.importCharacter).mockResolvedValue(imported());
    const { ctx, sent } = makeCtx({ args: { query: "Killua" }, userId: "owner1" });
    await importCommand.execute(ctx);
    expect(svc.claimVipImport).not.toHaveBeenCalled();
    expect(svc.refundVipImport).not.toHaveBeenCalled();
    expect(vi.mocked(svc.importCharacter).mock.calls[0][1].actor).toEqual({ id: "owner1", isOwner: true });
    expect(textOf(sent.at(-1))).toContain("importado com sucesso");
  });

  it("importado mas em quarentena: avisa que aguarda revisao", async () => {
    vi.mocked(svc.resolveImportRole).mockResolvedValue("vip");
    vi.mocked(svc.claimVipImport).mockResolvedValue({ ok: true, used: 1 });
    vi.mocked(svc.importCharacter).mockResolvedValue(
      imported({ status: "QUARANTINED", pendingReasons: ["UNKNOWN_GENDER"] })
    );
    const { ctx, sent } = makeCtx({ args: { query: "Killua" } });
    await importCommand.execute(ctx);
    expect(textOf(sent.at(-1))).toContain("gênero desconhecido");
    expect(svc.notifyCatalogUpdated).not.toHaveBeenCalled();
  });

  it("parseArgs junta os tokens do prefixo e o slash le a opcao name", () => {
    expect(importCommand.parseArgs!(["Killua", "Zoldyck"], {} as never)).toEqual({ query: "Killua Zoldyck" });
    const getString = vi.fn(() => "Gon");
    expect(importCommand.slashArgs!({ options: { getString } } as never)).toEqual({ query: "Gon" });
    expect(getString).toHaveBeenCalledWith("name", true);
  });
});

describe("$suggest", () => {
  const input = { guildId: "g1", userId: "u1", username: "alice", characterName: "Eren Yeager" };

  it("cria a sugestao e confirma com o prefixo do servidor", async () => {
    vi.mocked(svc.createSuggestion).mockResolvedValue({ status: "created", id: 1, pending: 1 });
    const { ctx, sent } = makeCtx({ args: { query: "Eren   Yeager" }, prefix: "!" });
    await suggestCommand.execute(ctx);
    expect(vi.mocked(svc.createSuggestion).mock.calls[0][1]).toEqual(input);
    expect(textOf(sent[0])).toContain("Sugestão Enviada");
    expect(textOf(sent[0])).toContain("!approvesuggest");
  });

  it("limite de pendentes, duplicada e ja no catalogo", async () => {
    const run = async (result: Awaited<ReturnType<typeof svc.createSuggestion>>) => {
      vi.mocked(svc.createSuggestion).mockResolvedValue(result);
      const { ctx, sent } = makeCtx({ args: { query: "Eren" } });
      await suggestCommand.execute(ctx);
      return textOf(sent[0]);
    };
    expect(await run({ status: "limit", max: 5 })).toContain("**5** sugestões pendentes");
    expect(await run({ status: "duplicate" })).toContain("já está na fila");
    expect(await run({ status: "exists", entityName: "Eren Yeager", franchise: "AoT" })).toContain(
      "já está no catálogo"
    );
  });

  it("sem nome mostra o uso e nao grava", async () => {
    const { ctx, sent } = makeCtx({ args: { query: "" } });
    await suggestCommand.execute(ctx);
    expect(textOf(sent[0])).toContain("Digite o nome do personagem que deseja sugerir");
    expect(svc.createSuggestion).not.toHaveBeenCalled();
  });
});

describe("$suggestlist / $approvesuggest (staff)", () => {
  const row = (name: string) => ({
    id: 1,
    guildId: "g1",
    userId: "222",
    characterName: name,
    status: "PENDING" as const,
    anilistId: null,
    resolvedEntityId: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
  });

  it("membro comum e barrado", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(false);
    const { ctx } = makeCtx({ isAdmin: false });
    const err = await suggestListCommand.execute(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.key).toBe("catalog.suggest_admin_only");
    const err2 = await approveSuggestCommand.execute(makeCtx({ args: { query: "x" } }).ctx).catch((e) => e);
    expect(err2.key).toBe("catalog.suggest_admin_only");
  });

  it("Administrator ve so as sugestoes do proprio servidor", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(false);
    vi.mocked(svc.listPendingSuggestions).mockResolvedValue({ rows: [row("Eren")], total: 1 });
    const { ctx, sent } = makeCtx({ isAdmin: true });
    await suggestListCommand.execute(ctx);
    expect(vi.mocked(svc.listPendingSuggestions).mock.calls[0][1]).toMatchObject({ guildId: "g1" });
    expect(textOf(sent[0])).toContain("1 Pendentes");
    expect(textOf(sent[0])).toContain("`Eren` sugerido por <@222>");
  });

  it("owner/moderador do catalogo ve a fila global; fila vazia tem mensagem propria", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    vi.mocked(svc.listPendingSuggestions).mockResolvedValue({ rows: [], total: 0 });
    const { ctx, sent } = makeCtx({ isAdmin: false });
    await suggestListCommand.execute(ctx);
    expect(vi.mocked(svc.listPendingSuggestions).mock.calls[0][1]).not.toHaveProperty("guildId");
    expect(textOf(sent[0])).toContain("Não há nenhuma sugestão pendente");
  });

  it("aprova: reserva a sugestao, importa pelo nome da sugestao e resolve com a entidade", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(false);
    vi.mocked(svc.findPendingSuggestion).mockResolvedValue(row("Eren Yeager") as never);
    vi.mocked(svc.claimSuggestion).mockResolvedValue(true);
    vi.mocked(svc.importCharacter).mockResolvedValue(imported());
    const { ctx, sent } = makeCtx({ isAdmin: true, args: { query: "eren" } });
    await approveSuggestCommand.execute(ctx);
    expect(vi.mocked(svc.importCharacter).mock.calls[0][0]).toBe("Eren Yeager");
    expect(svc.resolveSuggestion).toHaveBeenCalledWith(expect.anything(), 1, { entityId: 7, anilistId: 27 });
    expect(svc.releaseSuggestion).not.toHaveBeenCalled();
    expect(textOf(sent[0])).toContain("aprovada");
    expect(textOf(sent[1])).toContain("Killua Zoldyck");
  });

  it("importacao que nao acha: a sugestao volta para a fila", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    vi.mocked(svc.findPendingSuggestion).mockResolvedValue(row("Zzz") as never);
    vi.mocked(svc.claimSuggestion).mockResolvedValue(true);
    vi.mocked(svc.importCharacter).mockResolvedValue({ kind: "not_found" });
    const { ctx, sent } = makeCtx({ args: { query: "zzz" } });
    await approveSuggestCommand.execute(ctx);
    expect(svc.releaseSuggestion).toHaveBeenCalledWith(expect.anything(), 1);
    expect(svc.resolveSuggestion).not.toHaveBeenCalled();
    expect(textOf(sent.at(-1))).toContain("Nenhum personagem encontrado");
  });

  it("outro staff ja reservou: nao importa", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    vi.mocked(svc.findPendingSuggestion).mockResolvedValue(row("Eren") as never);
    vi.mocked(svc.claimSuggestion).mockResolvedValue(false);
    const { ctx, sent } = makeCtx({ args: { query: "eren" } });
    await approveSuggestCommand.execute(ctx);
    expect(svc.importCharacter).not.toHaveBeenCalled();
    expect(textOf(sent[0])).toContain("já foi processado");
  });

  it("sem sugestao correspondente, importa o nome digitado (como no legado)", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    vi.mocked(svc.findPendingSuggestion).mockResolvedValue(null);
    vi.mocked(svc.importCharacter).mockResolvedValue(imported());
    const { ctx } = makeCtx({ args: { query: "Gon Freecss" } });
    await approveSuggestCommand.execute(ctx);
    expect(vi.mocked(svc.importCharacter).mock.calls[0][0]).toBe("Gon Freecss");
    expect(svc.claimSuggestion).not.toHaveBeenCalled();
    expect(svc.resolveSuggestion).not.toHaveBeenCalled();
  });
});

describe("/catalog", () => {
  it("quem nao e owner nem moderador e barrado", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(false);
    const { ctx } = makeCtx({ args: { sub: "review" } });
    const err = await catalogCommand.execute(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.key).toBe("common.no_permission");
    expect(renderReview).not.toHaveBeenCalled();
  });

  it("review abre o painel (ephemeral) na primeira pendencia", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    const { ctx, sent } = makeCtx({ args: { sub: "review" } });
    await catalogCommand.execute(ctx);
    expect(renderReview).toHaveBeenCalledWith(expect.anything(), "pt-BR", null);
    expect(sent[0]).toMatchObject({ ephemeral: true });
  });

  it("merge sem ids mostra o uso; ids inexistentes avisam", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    const a = makeCtx({ args: { sub: "merge", id1: 1 } });
    await catalogCommand.execute(a.ctx);
    expect(textOf(a.sent[0])).toContain("catalog merge <id1> <id2>");

    vi.mocked(svc.previewMerge).mockResolvedValue({ ok: false, code: "not_found", id: 99 });
    const b = makeCtx({ args: { sub: "merge", id1: 1, id2: 99 } });
    await catalogCommand.execute(b.ctx);
    expect(textOf(b.sent[0])).toContain("#99 não encontrada");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("merge pede confirmacao; cancelado nao mescla", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    vi.mocked(svc.previewMerge).mockResolvedValue({
      ok: true,
      winner: { id: 1, name: "Killua" },
      loser: { id: 2, name: "Kirua" },
    });
    vi.mocked(confirm).mockResolvedValue(false);
    const { ctx, sent } = makeCtx({ args: { sub: "merge", id1: 1, id2: 2 } });
    await catalogCommand.execute(ctx);
    const opts = vi.mocked(confirm).mock.calls[0][0];
    expect(opts).toMatchObject({ ownerId: "u1", danger: true });
    expect(opts.prompt).toContain("Kirua");
    expect(opts.prompt).toContain("#2");
    expect(svc.mergeCatalogEntities).not.toHaveBeenCalled();
    expect(sent.at(-1).content).toBe("Ação cancelada.");
  });

  it("merge confirmado: id1 permanece, id2 e absorvida, pool e avisado", async () => {
    vi.mocked(isCatalogModerator).mockResolvedValue(true);
    vi.mocked(svc.previewMerge).mockResolvedValue({
      ok: true,
      winner: { id: 1, name: "Killua" },
      loser: { id: 2, name: "Kirua" },
    });
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(svc.mergeCatalogEntities).mockResolvedValue({
      ok: true,
      winner: { id: 1, name: "Killua" },
      loser: { id: 2, name: "Kirua" },
      result: { pactsMoved: 3, pactConflicts: 1, wishesMoved: 2 } as never,
    });
    const { ctx, sent } = makeCtx({ args: { sub: "merge", id1: 1, id2: 2 } });
    await catalogCommand.execute(ctx);
    expect(vi.mocked(svc.mergeCatalogEntities).mock.calls[0].slice(1)).toEqual([1, 2, "u1"]);
    expect(svc.notifyCatalogUpdated).toHaveBeenCalledWith("merge");
    const text = textOf(sent.at(-1));
    expect(text).toContain("**Kirua** foi mesclado em **Killua**");
    expect(text).toContain("Pactos movidos: 3 (conflitos: 1)");
  });

  it("parseArgs do prefixo e slashArgs dos subcomandos", () => {
    expect(catalogCommand.parseArgs!(["MERGE", "10", "11"], {} as never)).toEqual({ sub: "merge", id1: "10", id2: "11" });
    expect(catalogCommand.parseArgs!([], {} as never)).toEqual({ sub: undefined, id1: undefined, id2: undefined });
    const parsed = catalogCommand.args!.parse({ sub: undefined, id1: "10", id2: "11" });
    expect(parsed).toEqual({ sub: "review", id1: 10, id2: 11 });
    expect(() => catalogCommand.args!.parse({ sub: "nope" })).toThrow();
    const options = { getSubcommand: () => "merge", getInteger: (n: string) => (n === "id1" ? 5 : null) };
    expect(catalogCommand.slashArgs!({ options } as never)).toEqual({ sub: "merge", id1: 5, id2: undefined });
  });
});
