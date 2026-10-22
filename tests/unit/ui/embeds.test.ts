import { afterEach, describe, expect, it } from "vitest";
import { EmbedBuilder } from "discord.js";
import { EMBED_FOOTER } from "../../../src/config/constants.js";
import { CARD_VARIANTS, ENTITY_TIERS } from "../../../src/config/gacha.js";
import {
  baseEmbed,
  errorEmbed,
  infoEmbed,
  successEmbed,
  warnEmbed,
} from "../../../src/ui/embeds.js";
import {
  DEFAULT_EMOJIS,
  emoji,
  genderEmoji,
  relicEmoji,
  resetEmojiOverrides,
  setEmojiOverrides,
  variantEmoji,
} from "../../../src/ui/emojis.js";
import {
  STATE_COLORS,
  TIER_COLORS,
  UI_STATES,
  VARIANT_PALETTES,
  colorForState,
  colorForTier,
  colorForVariant,
} from "../../../src/ui/tokens.js";

afterEach(() => {
  resetEmojiOverrides();
  delete process.env.ARQON_EMOJIS;
});

describe("tokens", () => {
  it("cobre todos os tiers, variantes e estados", () => {
    for (const tier of ENTITY_TIERS) expect(colorForTier(tier)).toBe(TIER_COLORS[tier]);
    for (const v of CARD_VARIANTS) expect(colorForVariant(v)).toBe(VARIANT_PALETTES[v].embed);
    for (const s of UI_STATES) expect(colorForState(s)).toBe(STATE_COLORS[s]);
  });

  it("variantes reaproveitam as cores do summon atual", () => {
    expect(colorForVariant("STANDARD")).toBe(0x5865f2);
    expect(colorForVariant("FOIL")).toBe(0xcbd5e1);
    expect(colorForVariant("HOLO")).toBe(0xfacc15);
    expect(colorForVariant("ASTRAL")).toBe(0xd946ef);
    expect(colorForState("free")).toBe(0xe03b54);
    expect(colorForState("success")).toBe(0x4ade80);
  });

  it("valores desconhecidos caem no padrao", () => {
    expect(colorForVariant("???")).toBe(VARIANT_PALETTES.STANDARD.embed);
    expect(colorForVariant(null)).toBe(VARIANT_PALETTES.STANDARD.embed);
    expect(colorForTier("???")).toBe(TIER_COLORS.COMMON);
  });

  it("todas as cores sao inteiros RGB validos e os tiers sao distintos", () => {
    const all = [
      ...Object.values(TIER_COLORS),
      ...Object.values(STATE_COLORS),
      ...Object.values(VARIANT_PALETTES).flatMap((p) => Object.values(p)),
    ];
    for (const c of all) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
    expect(new Set(Object.values(TIER_COLORS)).size).toBe(ENTITY_TIERS.length);
  });
});

describe("embed builders", () => {
  it("sempre retornam EmbedBuilder com cor do estado e rodape padrao", () => {
    const cases = [
      [successEmbed("ok"), "success"],
      [warnEmbed("hm"), "warn"],
      [infoEmbed("fyi"), "info"],
      [errorEmbed("falhou"), "error"],
    ] as const;
    for (const [embed, state] of cases) {
      expect(embed).toBeInstanceOf(EmbedBuilder);
      const json = embed.toJSON();
      expect(json.color).toBe(colorForState(state));
      expect(json.footer?.text).toBe(EMBED_FOOTER);
      expect(json.timestamp).toBeUndefined();
    }
  });

  it("aceita conteudo vazio", () => {
    expect(successEmbed()).toBeInstanceOf(EmbedBuilder);
    expect(errorEmbed().toJSON().description).toContain("Algo deu errado");
  });

  it("errorEmbed mostra o ID do erro no rodape", () => {
    const json = errorEmbed("falhou", "a1b2c3d4").toJSON();
    expect(json.footer?.text).toBe(`ID do erro: a1b2c3d4 • ${EMBED_FOOTER}`);
    expect(json.description).toBe("falhou");
  });

  it("errorEmbed localiza o rotulo do ID", () => {
    const json = errorEmbed({ description: "failed", locale: "en-US" }, "ff00").toJSON();
    expect(json.footer?.text).toContain("Error ID: ff00");
  });

  it("errorEmbed sem ID mantem o rodape padrao", () => {
    expect(errorEmbed("x").toJSON().footer?.text).toBe(EMBED_FOOTER);
  });

  it("titulo recebe emoji do estado; icon:false desliga", () => {
    expect(successEmbed({ title: "Feito" }).toJSON().title).toBe(`${emoji("success")} Feito`);
    expect(successEmbed({ title: "Feito", icon: false }).toJSON().title).toBe("Feito");
  });

  it("timestamp opcional", () => {
    expect(baseEmbed({ timestamp: true }).toJSON().timestamp).toBeDefined();
    const fixed = new Date("2026-01-01T00:00:00Z");
    expect(baseEmbed({ timestamp: fixed }).toJSON().timestamp).toBe(fixed.toISOString());
    expect(baseEmbed().toJSON().timestamp).toBeUndefined();
  });

  it("cor e rodape customizaveis; rodape pode ser removido", () => {
    const json = baseEmbed({ color: 0x123456, footer: "meu rodape" }).toJSON();
    expect(json.color).toBe(0x123456);
    expect(json.footer?.text).toBe("meu rodape");
    expect(baseEmbed({ footer: false }).toJSON().footer).toBeUndefined();
  });

  it("respeita limites do Discord", () => {
    const json = baseEmbed({ title: "t".repeat(500), description: "d".repeat(5000) }).toJSON();
    expect(json.title!.length).toBeLessThanOrEqual(256);
    expect(json.description!.length).toBeLessThanOrEqual(4096);
  });
});

describe("emojis", () => {
  it("defaults do dominio", () => {
    expect(emoji("aether")).toBe("💠");
    expect(emoji("pact")).toBe("❤️");
    expect(emoji("key")).toBe("🗝️");
    expect(genderEmoji("FEMALE")).toBe("♀");
    expect(genderEmoji("MALE")).toBe("♂");
    expect(genderEmoji("BOTH")).toBe("⚧");
    expect(genderEmoji(undefined)).toBe("⚧");
    expect(variantEmoji("ASTRAL")).toBe("🔮");
    expect(variantEmoji("nope")).toBe("📜");
    expect(relicEmoji("ruby")).toBe("🩸");
    expect(Object.keys(DEFAULT_EMOJIS).length).toBeGreaterThan(30);
  });

  it("override por objeto", () => {
    setEmojiOverrides({ aether: "<:aether:123456789012345678>" });
    expect(emoji("aether")).toBe("<:aether:123456789012345678>");
    expect(emoji("pact")).toBe("❤️");
    resetEmojiOverrides();
    expect(emoji("aether")).toBe("💠");
  });

  it("override por ambiente ignora chaves e JSON invalidos", () => {
    process.env.ARQON_EMOJIS = JSON.stringify({ key: "<:k:1>", naoExiste: "x" });
    expect(emoji("key")).toBe("<:k:1>");
    resetEmojiOverrides();
    process.env.ARQON_EMOJIS = "{quebrado";
    expect(emoji("key")).toBe("🗝️");
  });
});
