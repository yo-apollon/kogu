import { afterEach, describe, expect, it } from "vitest";
import { SKIN_EVENTS } from "../../../src/config/gacha.js";
import { getSkin, listSkins, registerSkin, selectSkin } from "../../../src/canvas/skins/registry.js";
import type { CardSkin, SkinMatchContext } from "../../../src/canvas/skins/types.js";

const base: SkinMatchContext = { universe: "ORIGINAL", tier: "COMMON", variant: "STANDARD", now: new Date("2026-06-01T12:00:00Z") };
const REQUIRED_LAYERS = ["background", "portrait", "effects", "nameplate", "stats", "badges", "frame"];

afterEach(() => {
  SKIN_EVENTS.length = 0;
});

describe("registry de skins", () => {
  it("registra as 5 skins embutidas", () => {
    expect(listSkins().map((s) => s.id)).toEqual(["classic", "anime-neon", "game-hud", "cinema-noir", "mudae"]);
  });

  it("toda skin tem versao, tamanho e camadas (mudae: 480x750, arte limpa sem texto/stats)", () => {
    for (const skin of listSkins()) {
      expect(skin.version).toBeGreaterThanOrEqual(1);
      if (skin.id === "mudae") {
        expect(skin.size).toEqual({ w: 480, h: 750 });
        expect(skin.layers.map((l) => l.id)).toEqual(["background", "portrait", "effects", "frame"]);
      } else {
        expect(skin.size).toEqual({ w: 480, h: 700 });
        expect(skin.layers.map((l) => l.id).sort()).toEqual([...REQUIRED_LAYERS].sort());
      }
    }
  });

  it("mudae e o padrao: vence skins de universo e classic em qualquer universo", () => {
    for (const u of ["ANIME", "GAME", "CINEMA", "MYTHOLOGY", "ORIGINAL", "WEAPON"] as const) {
      expect(selectSkin({ ...base, universe: u }).id).toBe("mudae");
    }
  });

  it("skins de universo seguem disponiveis como skin preferida do dono", () => {
    expect(selectSkin({ ...base, universe: "ANIME", preferredSkinId: "anime-neon" }).id).toBe("anime-neon");
    expect(selectSkin({ ...base, universe: "GAME", preferredSkinId: "game-hud" }).id).toBe("game-hud");
    expect(selectSkin({ ...base, universe: "CINEMA", preferredSkinId: "cinema-noir" }).id).toBe("cinema-noir");
  });

  it("skin preferida do dono vence universo", () => {
    expect(selectSkin({ ...base, universe: "ANIME", preferredSkinId: "cinema-noir" }).id).toBe("cinema-noir");
    expect(selectSkin({ ...base, universe: "ANIME", preferredSkinId: "classic" }).id).toBe("classic");
  });

  it("skin preferida desconhecida e ignorada", () => {
    expect(selectSkin({ ...base, universe: "GAME", preferredSkinId: "nao-existe" }).id).toBe("mudae");
  });

  it("evento ativo vence mudae, mas perde para a preferida do dono", () => {
    SKIN_EVENTS.push({ skinId: "cinema-noir", startsAt: "2026-05-01T00:00:00Z", endsAt: "2026-07-01T00:00:00Z" });
    expect(selectSkin({ ...base, universe: "ANIME" }).id).toBe("cinema-noir");
    expect(selectSkin({ ...base, universe: "ANIME", preferredSkinId: "game-hud" }).id).toBe("game-hud");
  });

  it("evento fora da janela nao conta", () => {
    SKIN_EVENTS.push({ skinId: "cinema-noir", startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" });
    expect(selectSkin({ ...base, universe: "ANIME" }).id).toBe("mudae");
  });

  it("registerSkin adiciona skin nova e getSkin a encontra", () => {
    const custom: CardSkin = { ...getSkin("classic")!, id: "custom-test", match: (c) => (c.universe === "WEAPON" ? 30 : 0) };
    registerSkin(custom);
    expect(getSkin("custom-test")).toBe(custom);
    expect(selectSkin({ ...base, universe: "WEAPON" }).id).toBe("custom-test");
  });

  it("classic pontua 1 (fallback antigo) e mudae 20 (padrao)", () => {
    expect(getSkin("classic")!.match(base)).toBe(1);
    expect(getSkin("mudae")!.match(base)).toBe(20);
  });
});
