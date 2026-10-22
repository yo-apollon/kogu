import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLocale, hasKey, t, tPlural, translator } from "../../../src/i18n/index.js";
import { TRANSLATION_KEYS } from "../../../src/i18n/keys.js";

const localesDir = path.resolve(__dirname, "../../../locales");
const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(localesDir, `${name}.json`), "utf-8"));

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix + k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object")
      Object.assign(out, flatten(v as Record<string, unknown>, `${key}.`));
    else throw new Error(`valor invalido em ${key}`);
  }
  return out;
}

const pt = flatten(load("pt-BR"));
const en = flatten(load("en-US"));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("paridade pt-BR x en-US", () => {
  it("mesmas chaves nos dois idiomas", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
  });

  it("mesmos placeholders em cada chave", () => {
    for (const key of Object.keys(pt)) {
      expect(placeholders(en[key]!), key).toEqual(placeholders(pt[key]!));
    }
  });

  it("nenhum valor vazio", () => {
    for (const [k, v] of [...Object.entries(pt), ...Object.entries(en)]) {
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it("chaves existentes do bot antigo foram preservadas", () => {
    for (const key of [
      "common.loading",
      "common.error",
      "common.no_permission",
      "common.cooldown",
      "summon.title",
      "summon.pact_failed_taken",
      "summon.pact_no_charges",
      "pantheon.empty",
      "pantheon.title",
      "relics.emerald",
    ]) {
      expect(pt[key], key).toBeDefined();
      expect(en[key], key).toBeDefined();
    }
  });

  it("areas pedidas existem", () => {
    const areas = new Set(Object.keys(pt).map((k) => k.split(".")[0]));
    for (const area of [
      "common",
      "errors",
      "ui",
      "summon",
      "collection",
      "economy",
      "config",
      "help",
      "catalog",
    ]) {
      expect(areas.has(area), area).toBe(true);
    }
    expect(Object.keys(pt).some((k) => k.startsWith("ui.paginator."))).toBe(true);
    expect(Object.keys(pt).some((k) => k.startsWith("ui.confirm."))).toBe(true);
  });

  it("chaves de plural vem em pares one/other", () => {
    const bases = new Set(
      Object.keys(pt)
        .filter((k) => k.endsWith("_one"))
        .map((k) => k.slice(0, -4))
    );
    expect(bases.size).toBeGreaterThan(0);
    for (const base of bases) expect(pt[`${base}_other`], base).toBeDefined();
  });
});

describe("keys.ts", () => {
  it("TRANSLATION_KEYS espelha locales/pt-BR.json (regenere keys.ts se falhar)", () => {
    expect([...TRANSLATION_KEYS].sort()).toEqual(Object.keys(pt).sort());
  });
});

describe("t()", () => {
  it("traduz por idioma", () => {
    expect(t("summon.pact_failed_taken", "pt-BR")).toBe(
      "⚡ Tarde demais! Outro invocador já selou o pacto."
    );
    expect(t("summon.pact_failed_taken", "en-US")).toContain("Too late");
  });

  it("assume pt-BR sem idioma", () => {
    expect(t("common.yes")).toBe("Sim");
  });

  it("substitui placeholders (todas as ocorrencias)", () => {
    expect(t("common.cooldown", "pt-BR", { seconds: 5 })).toContain("5 segundos");
    expect(t("pantheon.title", "en-US", { user: "Ana" })).toContain("Ana");
    expect(t("summon.rolls_exhausted", "pt-BR", { current: 0, max: 10, prefix: "$" })).toContain(
      "`$tu`"
    );
  });

  it("nao interpreta $ especiais do replace e preserva placeholders sem valor", () => {
    expect(t("summon.pact_success", "pt-BR", { user: "$&x", entity: "$1" })).toContain("**$&x**");
    expect(t("summon.pact_success", "pt-BR", { user: "A" })).toContain("{entity}");
  });

  it("fallback para pt-BR com idioma desconhecido", () => {
    expect(t("common.yes", "es-ES")).toBe("Sim");
    expect(t("common.yes", "xx")).toBe("Sim");
  });

  it("aceita codigos nao normalizados", () => {
    expect(t("common.yes", "en")).toBe("Yes");
    expect(t("common.yes", "pt-br")).toBe("Sim");
  });

  it("chave inexistente devolve a propria chave", () => {
    expect(t("nao.existe", "pt-BR")).toBe("nao.existe");
    expect(t("nao.existe", "en-US")).toBe("nao.existe");
  });

  it("chave que aponta para objeto devolve a propria chave", () => {
    expect(t("summon", "pt-BR")).toBe("summon");
  });

  it("hasKey e translator", () => {
    expect(hasKey("common.yes")).toBe(true);
    expect(hasKey("common")).toBe(false);
    expect(translator("en-US")("common.no")).toBe("No");
  });
});

describe("getLocale", () => {
  it.each([
    ["pt-BR", "pt-BR"],
    ["pt-br", "pt-BR"],
    ["pt_BR", "pt-BR"],
    ["pt", "pt-BR"],
    ["PT-PT", "pt-BR"],
    ["en", "en-US"],
    ["en-US", "en-US"],
    ["en-us", "en-US"],
    ["en-GB", "en-US"],
    ["es-ES", "pt-BR"],
    ["", "pt-BR"],
    [null, "pt-BR"],
    [undefined, "pt-BR"],
  ])("%j -> %s", (raw, expected) => {
    expect(getLocale(raw as string | null | undefined)).toBe(expected);
  });
});

describe("tPlural", () => {
  it("seleciona singular/plural em en-US", () => {
    expect(tPlural("common.entities", 1, "en-US")).toBe("1 entity");
    expect(tPlural("common.entities", 2, "en-US")).toBe("2 entities");
    expect(tPlural("common.entities", 0, "en-US")).toBe("0 entities");
  });

  it("seleciona singular/plural em pt-BR", () => {
    expect(tPlural("common.rolls", 1, "pt-BR")).toBe("1 invocação");
    expect(tPlural("common.rolls", 5, "pt-BR")).toBe("5 invocações");
  });

  it("fallback para chave inexistente devolve a base", () => {
    expect(tPlural("nao.existe", 3, "pt-BR")).toBe("nao.existe");
  });
});
