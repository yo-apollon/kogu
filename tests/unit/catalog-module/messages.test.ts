import { describe, expect, it } from "vitest";
import { FALLBACK_MESSAGES, genderLabel, msg, reasonLabel } from "../../../src/modules/catalog/messages.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalog/messages", () => {
  it("pt-BR e en-US tem as mesmas chaves e os mesmos placeholders", () => {
    const pt = FALLBACK_MESSAGES["pt-BR"];
    const en = FALLBACK_MESSAGES["en-US"];
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    for (const key of Object.keys(pt)) {
      expect(placeholders(en[key]), key).toEqual(placeholders(pt[key]));
    }
  });

  it("usa o JSON de locales quando a chave existe e o fallback quando nao", () => {
    // existe em locales/pt-BR.json
    expect(msg("pt-BR", "catalog.import_usage", { prefix: "!" })).toContain("!import");
    // so no fallback
    expect(msg("pt-BR", "catalog.review_empty")).toContain("fila de moderação");
    expect(msg("en-US", "catalog.review_empty")).toContain("moderation queue");
  });

  it("interpola parametros do fallback e devolve a chave quando nao existe em lugar nenhum", () => {
    expect(msg("pt-BR", "catalog.review_rejected", { id: 12 })).toContain("#12");
    expect(msg("pt-BR", "catalog.chave_inexistente")).toBe("catalog.chave_inexistente");
  });

  it("rotulos de motivo e de genero", () => {
    expect(reasonLabel("pt-BR", "UNKNOWN_GENDER")).toBe("gênero desconhecido");
    expect(reasonLabel("en-US", "NO_IMAGE")).toBe("no image");
    expect(genderLabel("pt-BR", "FEMALE")).toBe("Feminino"); // do JSON
    expect(genderLabel("pt-BR", "NONBINARY")).toBe("Não binário"); // do fallback
  });
});
