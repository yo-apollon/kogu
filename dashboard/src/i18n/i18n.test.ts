import { describe, expect, it } from "vitest";
import enUS from "../../messages/en-US.json";
import ptBR from "../../messages/pt-BR.json";
import { negotiateLocale, resolveLocale } from "./config";

function keys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1] ?? "").sort();
}

function flat(obj: unknown, prefix = ""): Record<string, string> {
  if (typeof obj === "string") return { [prefix]: obj };
  return Object.entries(obj as Record<string, unknown>).reduce(
    (acc, [k, v]) => ({ ...acc, ...flat(v, prefix ? `${prefix}.${k}` : k) }),
    {},
  );
}

describe("mensagens", () => {
  it("pt-BR e en-US tem exatamente as mesmas chaves", () => {
    expect(keys(enUS).sort()).toEqual(keys(ptBR).sort());
  });

  it("placeholders ICU coincidem entre idiomas", () => {
    const pt = flat(ptBR);
    const en = flat(enUS);
    for (const [k, v] of Object.entries(pt)) {
      expect(placeholders(en[k] ?? ""), k).toEqual(placeholders(v));
    }
  });

  it("nao ha valores vazios", () => {
    for (const v of [...Object.values(flat(ptBR)), ...Object.values(flat(enUS))]) expect(v.trim()).not.toBe("");
  });
});

describe("locale", () => {
  it("cookie vence Accept-Language", () => {
    expect(resolveLocale("en-US", "pt-BR,pt;q=0.9")).toBe("en-US");
  });
  it("Accept-Language respeita q", () => {
    expect(negotiateLocale("fr;q=0.9, en;q=0.8, pt;q=0.7")).toBe("en-US");
    expect(negotiateLocale("en;q=0.4, pt-PT;q=0.8")).toBe("pt-BR");
  });
  it("cai em pt-BR", () => {
    expect(resolveLocale("xx", null)).toBe("pt-BR");
    expect(negotiateLocale("de, fr")).toBe("pt-BR");
  });
});
