import { describe, expect, it } from "vitest";
import {
  clampRelicLevel,
  emptyRelicLevels,
  parseRelicKey,
  planRelicUpgrade,
  RELIC_BASE_COST,
  RELIC_KEYS,
  RELIC_MAX_LEVEL,
  relicBar,
  relicDiscount,
  relicLabel,
  relicLevelsOf,
  relicUpgradeCost,
  totalRelicLevels,
  type RelicLevels,
} from "../../../src/modules/economy/relics.js";

const levels = (o: Partial<RelicLevels> = {}): RelicLevels => ({ ...emptyRelicLevels(), ...o });

describe("relicUpgradeCost (porte de handleRelicsCommand)", () => {
  it("custo = base * (nivel + 1) sem desconto para niveis base 0..3", () => {
    const base = {
      bronze: 500,
      silver: 1000,
      gold: 1500,
      sapphire: 2500,
      ruby: 4000,
      emerald: 5000,
    };
    expect(RELIC_BASE_COST).toEqual(base);
    for (const key of RELIC_KEYS) {
      for (let level = 0; level < 4; level++) {
        expect(relicUpgradeCost(key, level, 0)).toBe(base[key] * (level + 1));
      }
    }
    // valores do legado: bronze 500/1000/1500/2000, esmeralda 5000..20000
    expect([0, 1, 2, 3].map((l) => relicUpgradeCost("bronze", l, 0))).toEqual([
      500, 1000, 1500, 2000,
    ]);
    expect(relicUpgradeCost("emerald", 3, 0)).toBe(20000);
    // Ascensao Cosmica (Tier II: 4 -> 5)
    expect(relicUpgradeCost("bronze", 4, 0)).toBe(4000);
    expect(relicUpgradeCost("emerald", 4, 0)).toBe(40000);
  });

  it("nivel maximo nao tem proximo custo", () => {
    for (const key of RELIC_KEYS) expect(relicUpgradeCost(key, RELIC_MAX_LEVEL, 0)).toBeNull();
    expect(relicUpgradeCost("bronze", 9, 0)).toBeNull();
  });

  it("Rubi no nivel maximo da -25% em todas as evolucoes", () => {
    expect(relicDiscount(3)).toBe(1);
    expect(relicDiscount(4)).toBe(0.75);
    expect(relicDiscount(8)).toBe(0.65);
    expect(relicUpgradeCost("bronze", 0, 3)).toBe(500);
    expect(relicUpgradeCost("bronze", 0, 4)).toBe(375);
    expect(relicUpgradeCost("emerald", 3, 4)).toBe(15000);
    expect(relicUpgradeCost("silver", 1, 4)).toBe(1500);
  });

  it("niveis invalidos sao limitados a 0..8", () => {
    expect(clampRelicLevel(-3)).toBe(0);
    expect(clampRelicLevel(2.9)).toBe(2);
    expect(clampRelicLevel(99)).toBe(8);
    expect(clampRelicLevel("abc")).toBe(0);
    expect(clampRelicLevel(null)).toBe(0);
    expect(relicUpgradeCost("bronze", -1, 0)).toBe(500);
  });
});

describe("planRelicUpgrade", () => {
  it("ok: informa custo, niveis e saldo restante", () => {
    expect(planRelicUpgrade(levels({ bronze: 1 }), 1500, "bronze")).toEqual({
      kind: "ok",
      cost: 1000,
      fromLevel: 1,
      toLevel: 2,
      balanceAfter: 500,
    });
  });

  it("saldo exatamente igual ao custo basta", () => {
    expect(planRelicUpgrade(levels(), 500, "bronze")).toMatchObject({
      kind: "ok",
      balanceAfter: 0,
    });
  });

  it("insufficient: devolve custo e saldo", () => {
    expect(planRelicUpgrade(levels({ gold: 2 }), 100, "gold")).toEqual({
      kind: "insufficient",
      cost: 4500,
      balance: 100,
      level: 2,
    });
  });

  it("max tem prioridade mesmo com saldo sobrando", () => {
    expect(planRelicUpgrade(levels({ ruby: 8 }), 1_000_000, "ruby")).toEqual({
      kind: "max",
      level: 8,
    });
  });

  it("o desconto do Rubi entra no plano", () => {
    const plan = planRelicUpgrade(levels({ ruby: 4 }), 400, "bronze");
    expect(plan).toMatchObject({ kind: "ok", cost: 375, balanceAfter: 25 });
  });
});

describe("relicLevelsOf / totalRelicLevels", () => {
  it("le as colunas de guild_members e trata ausencia", () => {
    expect(
      relicLevelsOf({
        relicBronze: 4,
        relicSilver: 3,
        relicGold: 2,
        relicSapphire: 1,
        relicRuby: 0,
        relicEmerald: 9,
      })
    ).toEqual({ bronze: 4, silver: 3, gold: 2, sapphire: 1, ruby: 0, emerald: 8 });
    expect(relicLevelsOf(null)).toEqual(emptyRelicLevels());
    expect(relicLevelsOf({ relicGold: 2 }).gold).toBe(2);
    expect(totalRelicLevels(levels({ bronze: 4, gold: 2 }))).toBe(6);
  });
});

describe("parseRelicKey", () => {
  it("aceita chave, nome em portugues, acento e caixa", () => {
    expect(parseRelicKey("bronze")).toBe("bronze");
    expect(parseRelicKey("Prata")).toBe("silver");
    expect(parseRelicKey("OURO")).toBe("gold");
    expect(parseRelicKey("safira")).toBe("sapphire");
    expect(parseRelicKey("Rubi")).toBe("ruby");
    expect(parseRelicKey("esmeralda")).toBe("emerald");
    expect(parseRelicKey("emerald")).toBe("emerald");
    expect(parseRelicKey("Relíquia de Bronze")).toBe("bronze");
    expect(parseRelicKey("relic ruby")).toBe("ruby");
  });

  it("rejeita lixo e vazio", () => {
    expect(parseRelicKey("platina")).toBeNull();
    expect(parseRelicKey("")).toBeNull();
    expect(parseRelicKey(undefined)).toBeNull();
  });
});

describe("apresentacao", () => {
  it("relicBar mostra nivel/8 com emojis centralizados", () => {
    expect(relicBar(0)).toBe("⬛⬛⬛⬛⬛⬛⬛⬛");
    expect(relicBar(2)).toBe("🟩🟩⬛⬛⬛⬛⬛⬛");
    expect(relicBar(4)).toBe("🟩🟩🟩🟩⬛⬛⬛⬛");
    expect(relicBar(6)).toBe("🟩🟩🟩🟩🟪🟪⬛⬛");
    expect(relicBar(8)).toBe("🟩🟩🟩🟩🟪🟪🟪🟪");
  });

  it("relicLabel junta emoji e nome traduzido", () => {
    expect(relicLabel("bronze", "pt-BR")).toBe("🥉 Relíquia de Bronze");
    expect(relicLabel("emerald", "pt-BR")).toContain("Esmeralda");
  });
});
