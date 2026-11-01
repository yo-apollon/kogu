import { createCanvas } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { drawEmblem, EMBLEM_KEYS, ITEM_EMBLEMS, looksLikeObjectName, pickEmblem } from "../../../src/canvas/emblems/index.js";
import { ENTITY_TIERS } from "../../../src/config/gacha.js";
import { registerFonts } from "../../../src/canvas/engine/fonts.js";
import { planCard, renderCard } from "../../../src/canvas/engine/renderer.js";
import { resolveTheme } from "../../../src/canvas/theme/tokens.js";
import { sha1 } from "./helpers.js";

describe("pickEmblem", () => {
  const cases: Array<[string, string]> = [
    ["Espada de Fogo", "sword"],
    ["Lâmina Crisol", "sword"],
    ["Katana Negra", "sword"],
    ["Steel Sword", "sword"],
    ["Dark Blade", "sword"],
    ["Machado Leviatã", "axe"],
    ["War Axe", "axe"],
    ["Martelo do Trovão", "hammer"],
    ["Great Hammer", "hammer"],
    ["Cajado Arcano", "staff"],
    ["Magic Staff", "staff"],
    ["Elder Wand", "staff"],
    ["Escudo do Guardião", "shield"],
    ["Hero Shield", "shield"],
    ["Arco Longo", "bow"],
    ["Hunter Bow", "bow"],
    ["Pistola Antiga", "gun"],
    ["Arma de Fogo Rara", "gun"],
    ["Plasma Gun", "gun"],
    ["Foice da Morte", "scythe"],
    ["Reaper Scythe", "scythe"],
    ["Lança Sagrada", "spear"],
    ["Long Spear", "spear"],
    ["Adaga Sombria", "dagger"],
    ["Throwing Kunai", "dagger"],
    ["Sabre de Luz Azul", "energy_blade"],
    ["Green Lightsaber", "energy_blade"],
    ["Lâmina de Energia", "energy_blade"],
    ["Armadura Dourada", "armor"],
    ["Knight Armor", "armor"],
    ["Anel do Poder", "ring"],
    ["Silver Ring", "ring"],
    ["Livro Proibido", "book"],
    ["Old Grimoire", "book"],
    ["Caderno Sombrio", "book"],
    ["Orbe Celeste", "orb"],
    ["Crystal Orb", "orb"],
    ["Poção de Cura", "potion"],
    ["Healing Potion", "potion"],
    ["Coroa Real", "crown"],
    ["Royal Crown", "crown"],
    ["Joia Rara", "gem"],
    ["Algo Misterioso", "gem"],
  ];
  it.each(cases)("%s -> %s", (name, expected) => {
    expect(pickEmblem(name)).toBe(expected);
  });

  it("nao confunde palavras parecidas (ring em Spring, bow em Rainbow)", () => {
    expect(pickEmblem("Spring Festival")).toBe("gem");
    expect(pickEmblem("Rainbow Road")).toBe("gem");
  });

  it("usa a descricao quando o nome nao ajuda; o nome tem prioridade", () => {
    expect(pickEmblem("Frostmourne", "a runic sword of ice")).toBe("sword");
    expect(pickEmblem("Machado Antigo", "uma espada")).toBe("axe");
    expect(pickEmblem("Frostmourne", null)).toBe("gem");
  });

  it("looksLikeObjectName", () => {
    expect(looksLikeObjectName("Buster Sword")).toBe(true);
    expect(looksLikeObjectName("Cloud Strife")).toBe(false);
  });

  it("o conjunto cobre 18 itens genericos e o emblema de personagem", () => {
    expect(ITEM_EMBLEMS.length).toBe(18);
    expect(EMBLEM_KEYS).toContain("character");
  });
});

describe("drawEmblem", () => {
  beforeAll(() => registerFonts());
  const rect = { x: 0, y: 0, w: 480, h: 750 };

  function render(key: (typeof EMBLEM_KEYS)[number], tier: (typeof ENTITY_TIERS)[number], seed = 7, name = "Aiko Tanaka"): Buffer {
    const c = createCanvas(rect.w, rect.h);
    drawEmblem(c.getContext("2d"), key, rect, { theme: resolveTheme(tier, "STANDARD"), tier, seed, name });
    return c.toBuffer("image/png");
  }

  it.each(EMBLEM_KEYS.map((k) => [k]))("%s: deterministico e nao vazio", (key) => {
    const a = render(key, "EPIC");
    expect(sha1(a)).toBe(sha1(render(key, "EPIC")));
    expect(a.length).toBeGreaterThan(5000);
  });

  it("emblemas diferentes e tiers diferentes geram imagens diferentes", () => {
    const hashes = new Set(EMBLEM_KEYS.map((k) => sha1(render(k, "RARE"))));
    expect(hashes.size).toBe(EMBLEM_KEYS.length);
    const tiers = new Set(ENTITY_TIERS.map((t) => sha1(render("sword", t))));
    expect(tiers.size).toBe(ENTITY_TIERS.length);
  });

  it("a semente muda a decoracao de fundo", () => {
    expect(sha1(render("sword", "EPIC", 1))).not.toBe(sha1(render("sword", "EPIC", 2)));
  });

  it("o simbolo fica centralizado e o fundo escuro (canto escuro, centro claro)", () => {
    const c = createCanvas(rect.w, rect.h);
    const g = c.getContext("2d");
    drawEmblem(g, "shield", rect, { theme: resolveTheme("EPIC", "STANDARD"), tier: "EPIC", seed: 1 });
    const lum = (x: number, y: number): number => {
      const d = g.getImageData(x, y, 1, 1).data;
      return 0.299 * d[0]! + 0.587 * d[1]! + 0.114 * d[2]!;
    };
    expect(lum(8, 8)).toBeLessThan(60);
    expect(lum(290, 300)).toBeGreaterThan(120);
  });
});

describe("renderCard: arte confiavel x emblema", () => {
  const base = {
    entityId: "1",
    name: "Espada Teste",
    franchise: "Teste",
    universe: "ANIME" as const,
    variant: "STANDARD" as const,
    aetherValue: 100,
    tier: "EPIC" as const,
    skinId: "mudae",
    now: new Date("2026-01-01T00:00:00Z"),
  };
  const poster = "https://image.tmdb.org/t/p/w500/abc.jpg";
  // loader que falha se for chamado: emblema nao pode baixar imagem
  const loader = {
    load: async () => {
      throw new Error("nao devia baixar");
    },
  } as never;

  it("poster nao e baixado: desenha emblema", async () => {
    const buf = await renderCard({ ...base, entityType: "WEAPON", imageUrl: poster }, { loader, cache: false });
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("a chave de cache inclui o modo/emblema", () => {
    const a = planCard({ ...base, entityType: "WEAPON", name: "Espada Teste", imageUrl: poster });
    const b = planCard({ ...base, entityType: "WEAPON", name: "Machado Teste", imageUrl: poster });
    const c = planCard({
      ...base,
      entityType: "CHARACTER",
      name: "Espada Teste",
      imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b1-x.png",
    });
    expect(a.art).toEqual({ mode: "EMBLEM", emblem: "sword" });
    expect(b.art).toEqual({ mode: "EMBLEM", emblem: "axe" });
    expect(c.art.mode).toBe("IMAGE");
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
    expect(planCard({ ...base, entityType: "WEAPON", imageUrl: poster }).key).toBe(a.key);
  });

  it("emblema e deterministico entre renders", async () => {
    const input = { ...base, entityType: "WEAPON", imageUrl: poster };
    const a = await renderCard(input, { loader, cache: false });
    const b = await renderCard(input, { loader, cache: false });
    expect(sha1(a)).toBe(sha1(b));
  });
});
