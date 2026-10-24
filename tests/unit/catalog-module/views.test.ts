import { describe, expect, it } from "vitest";
import type { QueueItem } from "../../../src/modules/catalog/review.js";
import type { ImportedEntity } from "../../../src/modules/catalog/service.js";
import {
  CATALOG_REVIEW_NS,
  importEmbed,
  nameModal,
  outcomeNotice,
  parseReviewCustomId,
  parseReviewParts,
  reviewCustomId,
  reviewView,
  safeInlineName,
  suggestionListEmbed,
} from "../../../src/modules/catalog/views.js";
import { textOf } from "./helpers.js";

const entity = (over: Partial<ImportedEntity> = {}): ImportedEntity => ({
  id: 7,
  name: "Killua Zoldyck",
  franchise: "Hunter x Hunter",
  seriesTitle: "Hunter x Hunter (2011)",
  status: "ACTIVE",
  gender: "MALE",
  aether: 612,
  imageUrl: "https://s4.anilist.co/x.png",
  pendingReasons: [],
  ...over,
});

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 12,
  reason: "LOW_FAVORITES",
  kind: "waive",
  status: "PENDING",
  details: { favourites: 3, floor: 10, autoResolved: true },
  createdAt: new Date(),
  entity: {
    id: 7,
    name: "Killua",
    nameNative: "キルア",
    gender: "UNKNOWN",
    status: "QUARANTINED",
    isAdult: false,
    sourceFavorites: 3,
    franchise: "Hunter x Hunter",
    seriesTitle: "Hunter x Hunter (2011)",
    imageUrl: "https://s4.anilist.co/x.png",
  },
  other: null,
  siblingReasons: ["UNKNOWN_GENDER"],
  ...over,
});

const flat = (rows: any[]) => rows.flatMap((r) => r.toJSON().components as any[]);

describe("customId do painel (namespace cr)", () => {
  it("codifica e decodifica ida e volta", () => {
    const id = reviewCustomId("ok", 12);
    expect(id).toBe("cr:ok:12");
    expect(parseReviewCustomId(id)).toEqual({ control: "ok", itemId: 12 });
    expect(parseReviewParts(["nmm", "99"])).toEqual({ control: "nmm", itemId: 99 });
  });
  it("rejeita acao desconhecida, id invalido e outro namespace", () => {
    expect(parseReviewCustomId("cr:xx:1")).toBeNull();
    expect(parseReviewCustomId("cr:ok:abc")).toBeNull();
    expect(parseReviewCustomId("cr:ok")).toBeNull();
    expect(parseReviewCustomId("sm:ok:1")).toBeNull();
    expect(CATALOG_REVIEW_NS).toBe("cr");
  });
  it("nunca estoura 100 caracteres", () => {
    expect(reviewCustomId("nmm", 999_999_999_999).length).toBeLessThan(100);
  });
});

describe("importEmbed", () => {
  it("ativo: sucesso com o Eter formatado", () => {
    const text = textOf({ embeds: [importEmbed({ kind: "imported", entity: entity(), created: true, activated: false, anilistId: 27 }, "pt-BR")] });
    expect(text).toContain("Killua Zoldyck");
    expect(text).toContain("612");
    expect(text).toContain("importado com sucesso");
  });
  it("em revisao: lista os motivos traduzidos", () => {
    const text = textOf({
      embeds: [
        importEmbed(
          {
            kind: "imported",
            entity: entity({ status: "QUARANTINED", pendingReasons: ["LOW_FAVORITES", "UNKNOWN_GENDER", "LOW_FAVORITES"] }),
            created: true,
            activated: false,
            anilistId: 27,
          },
          "pt-BR"
        ),
      ],
    });
    expect(text).toContain("aguarda revisão");
    expect(text).toContain("poucos favoritos, gênero desconhecido");
    expect(text).toContain("/catalog review");
  });
  it("ja existente e desativado", () => {
    expect(textOf({ embeds: [importEmbed({ kind: "exists", entity: entity(), anilistId: 27 }, "pt-BR")] })).toContain("já está no catálogo");
    expect(textOf({ embeds: [importEmbed({ kind: "disabled", entity: entity({ status: "DISABLED" }) }, "en-US")] })).toContain("disabled");
  });
});

describe("suggestionListEmbed", () => {
  it("numera a partir do offset, escapa crase e mostra rodape com pagina", () => {
    const embed = suggestionListEmbed({
      rows: [
        { characterName: "Eren `Yeager`", userId: "111" },
        { characterName: "Mikasa", userId: "222" },
      ],
      total: 12,
      offset: 10,
      prefix: "!",
      locale: "pt-BR",
      pageLabel: "Página 2/2",
    });
    const text = textOf({ embeds: [embed] });
    expect(text).toContain("12 Pendentes");
    expect(text).toContain("**#11** `Eren 'Yeager'` sugerido por <@111>");
    expect(text).toContain("**#12** `Mikasa`");
    expect(text).toContain("!approvesuggest");
    expect(text).toContain("Página 2/2");
    expect(safeInlineName("a`b`  c")).toBe("a'b' c");
  });
});

describe("reviewView", () => {
  it("fila vazia: so o embed, sem componentes", () => {
    const view = reviewView({ item: null, position: 0, total: 0, locale: "pt-BR", notice: "ok" });
    expect(view.components).toEqual([]);
    expect(view.content).toBe("ok");
    expect(textOf(view)).toContain("fila de moderação está vazia");
  });

  it("item normal: navegacao, aprovar/rejeitar/corrigir nome e select de genero", () => {
    const view = reviewView({ item: item(), position: 3, total: 9, locale: "pt-BR" });
    expect(view.components).toHaveLength(3);
    const [nav, actions, select] = view.components.map((r) => (r as any).toJSON().components as any[]);
    expect(nav.map((c) => c.custom_id)).toEqual(["cr:prev:12", "cr:ind:12", "cr:next:12"]);
    expect(nav[1]).toMatchObject({ label: "3/9", disabled: true });
    expect(actions.map((c) => [c.custom_id, c.label])).toEqual([
      ["cr:ok:12", "Aprovar"],
      ["cr:no:12", "Rejeitar"],
      ["cr:nm:12", "Corrigir nome"],
    ]);
    expect(select[0].custom_id).toBe("cr:gn:12");
    expect(select[0].options.map((o: any) => o.value)).toEqual(["FEMALE", "MALE", "NONBINARY"]);
    const text = textOf(view);
    expect(text).toContain("poucos favoritos");
    expect(text).toContain("Fila #12 • item 3 de 9");
    const fields = (view.embeds[0].toJSON().fields ?? []).map((f) => f.name);
    expect(fields).toContain("Outros motivos pendentes");
  });

  it("duplicata: botoes viram Mesclar / Nao e duplicata e mostra a entidade existente", () => {
    const dup = item({
      reason: "DUPLICATE_SUSPECT",
      kind: "duplicate",
      other: { ...item().entity!, id: 3, name: "Killua Z.", status: "ACTIVE" },
    });
    const view = reviewView({ item: dup, position: 1, total: 1, locale: "pt-BR" });
    const actions = (view.components[1] as any).toJSON().components as any[];
    expect(actions.map((c) => c.label)).toEqual(["Mesclar duplicata", "Não é duplicata", "Corrigir nome"]);
    expect(textOf(view)).toContain("suspeita de duplicata");
    const fields = (view.embeds[0].toJSON().fields ?? []).map((f) => f.name);
    expect(fields).toContain("Possível duplicata de");
  });

  it("item sem entidade: sem select e sem corrigir nome", () => {
    const view = reviewView({
      item: item({ entity: null, reason: "OTHER", kind: "neutral", siblingReasons: [] }),
      position: 1,
      total: 1,
      locale: "en-US",
    });
    expect(view.components).toHaveLength(2);
    const actions = flat([view.components[1]]);
    expect(actions[2]).toMatchObject({ custom_id: "cr:nm:12", disabled: true });
  });

  it("detalhes automaticos nao poluem o painel", () => {
    const json = reviewView({ item: item(), position: 1, total: 1, locale: "pt-BR" }).embeds[0].toJSON();
    const info = json.fields?.find((f) => f.name === "Info")?.value ?? "";
    expect(info).toContain("favourites: 3");
    expect(info).not.toContain("autoResolved");
  });
});

describe("nameModal", () => {
  it("campo de texto com limites do pipeline e nome atual preenchido", () => {
    const json = nameModal(12, "Killua", "pt-BR").toJSON();
    expect(json.custom_id).toBe("cr:nmm:12");
    const input = (json.components[0] as any).components[0];
    expect(input).toMatchObject({ custom_id: "name", min_length: 2, max_length: 64, value: "Killua", required: true });
  });
});

describe("outcomeNotice", () => {
  it("traduz decisoes e bloqueios", () => {
    const base = { ok: true as const, entityId: 7, entityName: "Killua", status: "ACTIVE" as const, activated: false, disabled: false };
    expect(outcomeNotice({ ...base, action: "approved" }, 12, "pt-BR")).toBe("✅ Item #12 aprovado.");
    expect(outcomeNotice({ ...base, action: "approved", activated: true }, 12, "pt-BR")).toContain("foi ativado no catálogo");
    expect(outcomeNotice({ ...base, action: "rejected", disabled: true }, 12, "pt-BR")).toContain("foi desativado");
    expect(outcomeNotice({ ...base, action: "not_duplicate" }, 12, "en-US")).toContain("not a duplicate");
    expect(outcomeNotice({ ...base, action: "gender", gender: "FEMALE" }, 12, "pt-BR")).toContain("Feminino");
    expect(outcomeNotice({ ...base, action: "renamed", name: "Kirua" }, 12, "pt-BR")).toContain("Kirua");
    expect(outcomeNotice({ ...base, action: "merged", name: "A", winnerName: "B" }, 12, "pt-BR")).toContain("**A** foi mesclado em **B**");
    expect(outcomeNotice({ ok: false, code: "blocked_gender" }, 12, "pt-BR")).toContain("Defina o gênero");
    expect(outcomeNotice({ ok: false, code: "blocked_image" }, 12, "pt-BR")).toContain("não tem imagem ativa");
    expect(outcomeNotice({ ok: false, code: "invalid_name" }, 12, "pt-BR")).toContain("2 a 64");
    expect(outcomeNotice({ ok: false, code: "merge_failed", reason: "x" }, 12, "pt-BR")).toContain("x");
    expect(outcomeNotice({ ok: false, code: "stale" }, 12, "pt-BR")).toContain("já foi processado");
  });
});
