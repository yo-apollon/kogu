import { describe, expect, it, vi } from "vitest";
import { hasKey } from "../../../src/i18n/index.js";
import { UserError } from "../../../src/lib/errors.js";
import type { EntityHit, WishEntry } from "../../../src/modules/wishlist/service.js";
import {
  emptyWishlistEmbed,
  entityChoice,
  FALLBACK_TEXT,
  removedEmbed,
  renderWishlistPage,
  replyFallbackError,
  SLASH_TEXT,
  tr,
  wishFranchise,
  wishResultEmbed,
} from "../../../src/modules/wishlist/views.js";
import { embedText } from "./helpers.js";

const view = { locale: "pt-BR" as const, userName: "Alice", prefix: "$", pageSize: 5 };

function entry(over: Partial<WishEntry> = {}): WishEntry {
  return {
    entityId: 1,
    name: "Zero Two",
    seriesTitle: "Darling in the FranXX",
    franchiseName: null,
    baseAether: 1234,
    isStarwish: false,
    createdAt: new Date(0),
    ...over,
  };
}

const entity: EntityHit = { id: 1, name: "Zero Two", seriesTitle: "Darling in the FranXX", baseAether: 100 };

describe("tr / FALLBACK_TEXT", () => {
  it("usa o locale quando a chave existe (nao o fallback)", () => {
    expect(tr("pt-BR", "wishlist.removed", { entity: "Rem" })).toContain("Rem");
    expect(tr("en-US", "wishlist.limit_reached", { max: 10 })).toContain("full (10/10)");
  });

  it("chave ausente nos locales usa o fallback do idioma, com parametros", () => {
    for (const key of Object.keys(FALLBACK_TEXT)) {
      if (hasKey(key, "pt-BR")) continue; // ja migrada para locales/*.json
      expect(tr("pt-BR", key, { entity: "Rem", query: "rem", max: 3 })).not.toBe(key);
    }
    expect(FALLBACK_TEXT["wishlist.not_in_list"]!["pt-BR"]).toContain("{query}");
    expect(FALLBACK_TEXT["wishlist.already_added"]!["en-US"]).toContain("{entity}");
    expect(FALLBACK_TEXT["wishlist.starwish_limit_reached"]!["pt-BR"]).toContain("{max}");
  });

  it("chave desconhecida sem fallback devolve a propria chave", () => {
    expect(tr("pt-BR", "wishlist.nao_existe")).toBe("wishlist.nao_existe");
  });

  it("os fallbacks existem nos dois idiomas", () => {
    for (const texts of Object.values(FALLBACK_TEXT)) {
      expect(texts["pt-BR"]).toBeTruthy();
      expect(texts["en-US"]).toBeTruthy();
    }
  });
});

describe("replyFallbackError", () => {
  it("responde com o texto local quando a chave ainda nao esta nos locales", async () => {
    const reply = vi.fn(async () => undefined);
    const err = new UserError("wishlist.starwish_limit_reached", { max: 3 });
    const handled = await replyFallbackError({ reply, locale: "pt-BR" } as any, err);
    expect(handled).toBe(!hasKey("wishlist.starwish_limit_reached", "pt-BR"));
    if (handled) {
      const payload = (reply.mock.calls[0] as unknown[])[0];
      expect(embedText(payload)).toContain("3/3");
      expect((payload as any).ephemeral).toBe(true);
    }
  });

  it("nao trata erros que nao sao UserError nem chaves sem fallback", async () => {
    const reply = vi.fn(async () => undefined);
    expect(await replyFallbackError({ reply, locale: "pt-BR" } as any, new Error("x"))).toBe(false);
    expect(
      await replyFallbackError({ reply, locale: "pt-BR" } as any, new UserError("wishlist.not_found"))
    ).toBe(false);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("renderWishlistPage", () => {
  it("numera as linhas, mostra o icone de estelar, a obra e o Eter formatado", () => {
    const page = renderWishlistPage(
      [entry({ isStarwish: true }), entry({ entityId: 2, name: "Rem", seriesTitle: null, franchiseName: "Re:Zero" })],
      1,
      1,
      2,
      view
    );
    const text = embedText(page);
    expect(text).toContain("Alice");
    expect(text).toContain("(2/10)");
    expect(text).toContain("1. 🌟 **Zero Two** — *Darling in the FranXX* (💠 1.234)");
    expect(text).toContain("2. 🌠 **Rem** — *Re:Zero*");
    expect(text).toContain("$sw");
    expect(text).not.toContain("Página");
  });

  it("paginas seguintes continuam a numeracao e mostram o indicador de pagina", () => {
    const page = renderWishlistPage([entry({ name: "Sexto" })], 2, 3, 11, view);
    const text = embedText(page);
    expect(text).toContain("6. 🌠 **Sexto**");
    expect(text).toContain("Página 2/3");
  });

  it("escapa markdown e usa 'Desconhecido' quando nao ha obra", () => {
    const e = entry({ name: "Bold *Name*", seriesTitle: null, franchiseName: null });
    expect(wishFranchise(e, "pt-BR")).toBe("Desconhecido");
    expect(embedText(renderWishlistPage([e], 1, 1, 1, view))).toContain("Bold \\*Name\\*");
  });

  it("en-US", () => {
    const text = embedText(renderWishlistPage([entry()], 1, 1, 1, { ...view, locale: "en-US" }));
    expect(text).toContain("Alice's Wishlist");
  });
});

describe("embeds de resposta", () => {
  it("lista vazia mostra o prefixo do servidor", () => {
    expect(embedText({ embeds: [emptyWishlistEmbed("pt-BR", "!")] })).toContain("!wish");
  });

  it("wishResultEmbed por status", () => {
    const text = (status: any, isStarwish = false, locale: "pt-BR" | "en-US" = "pt-BR") =>
      embedText({ embeds: [wishResultEmbed(locale, { status, isStarwish, total: 1 }, entity)] });

    expect(text("added")).toContain("Adicionado à Lista de Desejos");
    expect(text("added")).toContain("Darling in the FranXX");
    expect(text("added", true)).toContain("Desejo Estelar Definido");
    expect(text("upgraded", true)).toContain("Desejo Estelar Definido");
    expect(text("removed")).toContain("removido");
    expect(text("exists")).toContain("Zero Two");
    expect(text("exists", false, "en-US")).toContain("Zero Two");
  });

  it("removedEmbed escapa o nome", () => {
    expect(embedText({ embeds: [removedEmbed("pt-BR", "A_B")] })).toContain("A\\_B");
  });
});

describe("entityChoice / SLASH_TEXT", () => {
  it("valor id:N e nome com a serie", () => {
    expect(entityChoice(entity)).toEqual({
      name: "Zero Two · Darling in the FranXX",
      value: "id:1",
    });
    expect(entityChoice({ ...entity, seriesTitle: null }).name).toBe("Zero Two");
  });

  it("trunca em 100 caracteres (limite do Discord)", () => {
    const choice = entityChoice({ ...entity, name: "N".repeat(150) });
    expect(Array.from(choice.name)).toHaveLength(100);
    expect(choice.name.endsWith("…")).toBe(true);
  });

  it("descricoes de slash cabem em 100 caracteres nos dois idiomas", () => {
    for (const texts of Object.values(SLASH_TEXT)) {
      for (const value of Object.values(texts)) expect(value.length).toBeLessThanOrEqual(100);
    }
  });
});
