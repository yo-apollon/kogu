import { describe, expect, it } from "vitest";
import { FALLBACK_MESSAGES, msg } from "../../../src/modules/admin/messages.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("admin/messages", () => {
  it("pt-BR e en-US tem as mesmas chaves e placeholders", () => {
    const pt = FALLBACK_MESSAGES["pt-BR"];
    const en = FALLBACK_MESSAGES["en-US"];
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    for (const key of Object.keys(pt)) expect(placeholders(en[key]), key).toEqual(placeholders(pt[key]));
  });

  it("le do JSON quando existe e do fallback quando falta", () => {
    expect(msg("pt-BR", "admin.setvip_ok", { userId: "1", tier: 3 })).toContain("**Tier 3**");
    expect(msg("en-US", "admin.thanos_confirm", { eligible: 9 })).toContain("**9** eligible");
    expect(msg("pt-BR", "admin.nao_existe")).toBe("admin.nao_existe");
  });
});
