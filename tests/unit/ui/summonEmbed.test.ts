import { describe, expect, it } from "vitest";
import { buildSummonButtons, buildSummonEmbed, powerOf, type SummonView } from "../../../src/ui/summonEmbed.js";
import { flattenComponents } from "./helpers.js";

const full: SummonView = {
  name: "Ryuji Sakamoto",
  franchise: "Persona 5",
  gender: "MALE",
  universe: "GAME",
  aetherValue: 380,
  awakeningKeys: 8,
  claimRank: 855,
  likeRank: 587,
  tier: "COMMON",
  variant: "STANDARD",
  ownerNote: "art by askziye",
  ownerPhrase: "For real ?!",
  hasCustomPic: true,
  customPicIndex: 1,
  ownerName: "hrtadorii",
  ownerAvatarUrl: "https://cdn.example/a.png",
  ownerKeys: 40,
  ownerPosition: 1,
};

describe("buildSummonEmbed", () => {
  it("caso completo (exemplo do Mudae), en-US", () => {
    const { embed, attachmentName } = buildSummonEmbed(full, { locale: "en-US" });
    const json = embed.toJSON();
    expect(attachmentName).toBe("card.webp");
    expect(json.author).toEqual({ name: "Ryuji Sakamoto" });
    expect(json.description).toBe(
      [
        "Persona 5 ♂",
        "*Game roulette*  ·  **380** 💠  ·  🗝️ (8)",
        "Pact Rank: #855",
        "Like Rank: #587",
        "Shard (+19)",
        "***art by askziye***",
        "━━━━━━━•·༺📜༻·•━━━━━━━",
        '**"For real ?!"**',
        "(Custom Pic 1)",
      ].join("\n")
    );
    expect(json.image).toEqual({ url: "attachment://card.webp" });
    expect(json.color).toBe(0xfacc15);
    expect(json.footer).toEqual({ text: "Belongs to hrtadorii ~~ 40 / 40 [1]", icon_url: "https://cdn.example/a.png" });
  });

  it("carta livre: cor neutra, sem linhas condicionais, footer free_for_pact", () => {
    const free: SummonView = {
      name: "Zero Two",
      franchise: "DARLING in the FRANXX",
      universe: "ANIME",
      aetherValue: 120,
      tier: "MYTHIC",
      variant: "HOLO",
    };
    const json = buildSummonEmbed(free, { locale: "en-US", attachmentName: "x.webp" }).embed.toJSON();
    expect(json.description).toBe(
      ["DARLING in the FRANXX ⚧", "*Animanga roulette*  ·  **120** 💠", "Skull (+26)"].join("\n")
    );
    expect(json.image?.url).toBe("attachment://x.webp");
    expect(json.color).toBe(0x2b2d31);
    expect(json.footer).toEqual({ text: "Free for Pact" });
  });

  it("cor do dono e limite de pacto configuravel; pt-BR", () => {
    const json = buildSummonEmbed({ ...full, ownerEmbedColor: 0x123456, ownerKeys: 3, ownerPosition: 7 }, { locale: "pt-BR", pactLimit: 50 }).embed.toJSON();
    expect(json.color).toBe(0x123456);
    expect(json.footer?.text).toBe("Pertence a hrtadorii ~~ 3 / 50 [7]");
  });

  it("divisor so aparece com nota ou frase; custom pic so com hasCustomPic", () => {
    const base: SummonView = { ...full, ownerNote: undefined, ownerPhrase: undefined, hasCustomPic: false };
    expect(buildSummonEmbed(base, { locale: "en-US" }).embed.toJSON().description).not.toContain("━");
    expect(buildSummonEmbed({ ...base, ownerPhrase: "oi" }, { locale: "en-US" }).embed.toJSON().description).toContain("━");
  });

  it("roleta por universo", () => {
    const d = (u: string) => buildSummonEmbed({ ...full, universe: u }, { locale: "en-US" }).embed.toJSON().description;
    expect(d("CINEMA")).toContain("*Cinema roulette*");
    expect(d("WEAPON")).toContain("*Dimensional roulette*");
  });

  it("regra do poder: floor(eter/20) + 5 por degrau de tier", () => {
    expect(powerOf(380, "COMMON")).toBe(19);
    expect(powerOf(380, "MYTHIC")).toBe(39);
    expect(powerOf(-5, "COMMON")).toBe(0);
  });
});

describe("buildSummonButtons", () => {
  it("so emoji, customIds sm:<acao>:<offerId>", () => {
    const comps = flattenComponents([buildSummonButtons("abc123")]);
    expect(comps.map((c) => c.custom_id)).toEqual(["sm:pact:abc123", "sm:like:abc123"]);
    expect(comps.every((c) => c.label === undefined && c.emoji)).toBe(true);
    const withOrb = flattenComponents([buildSummonButtons("abc123", { orb: true, disabled: true })]);
    expect(withOrb.map((c) => c.custom_id)).toEqual(["sm:pact:abc123", "sm:like:abc123", "sm:orb:abc123"]);
    expect(withOrb.every((c) => c.disabled === true)).toBe(true);
  });
});
