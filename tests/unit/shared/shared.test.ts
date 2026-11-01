import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as oldConfig from "../../../src/modules/config/service.js";
import * as oldCollection from "../../../src/modules/collection/service.js";
import * as oldRelics from "../../../src/modules/economy/relics.js";
import * as oldSummon from "../../../src/modules/summon/service.js";
import * as oldTime from "../../../src/lib/time.js";
import * as oldText from "../../../src/lib/text/normalize.js";
import * as guildSettings from "../../../src/shared/guildSettings.js";
import * as pantheon from "../../../src/shared/pantheon.js";
import * as relics from "../../../src/shared/relics.js";
import * as search from "../../../src/shared/search.js";
import * as text from "../../../src/shared/text.js";
import * as time from "../../../src/shared/time.js";
import { entities } from "../../../src/infra/db/schema/index.js";

const dialect = new PgDialect();
const toSql = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(q);

describe("shared/time", () => {
  it("lib/time reexporta as mesmas funcoes", () => {
    expect(oldTime.currentWindow).toBe(time.currentWindow);
    expect(oldTime.nextWindowStart).toBe(time.nextWindowStart);
    expect(oldTime.usedInWindow).toBe(time.usedInWindow);
    expect(oldSummon.usedInWindow).toBe(time.usedInWindow);
  });

  it("janelas: valores conhecidos", () => {
    const now = 60 * 60_000 * 10 + 5 * 60_000; // 10h05
    expect(time.currentWindow(60, 0, now)).toBe(10);
    expect(time.currentWindow(60, 30, now)).toBe(9);
    expect(time.nextWindowStart(60, 0, now)).toBe(11 * 60 * 60_000);
    expect(time.nextWindowStart(180, 7, now)).toBe((4 * 180 + 7) * 60_000);
    expect(time.usedInWindow(3, 4, 3)).toBe(4);
    expect(time.usedInWindow(2, 4, 3)).toBe(0);
    expect(time.usedInWindow(5, 4, 3)).toBe(4);
  });
});

describe("shared/text", () => {
  it("lib/text/normalize e collection reexportam a mesma implementacao", () => {
    expect(oldText.normalizeName).toBe(text.normalizeName);
    expect(oldText.nameTokens).toBe(text.nameTokens);
    expect(oldText.escapeLike).toBe(text.escapeLike);
    expect(oldCollection.escapeLike).toBe(text.escapeLike);
  });

  it("normalizeName preserva o comportamento", () => {
    expect(text.normalizeName("  Éowyn   O'Brien-Ünal! ")).toBe("eowyn obrien unal");
    expect(text.normalizeName("Ｇｏｊｏ　Satoru")).toBe("gojo satoru");
    expect(text.normalizeName("ガッシュ・ベル")).toBe("ガッシュ ベル");
    expect(text.normalizeName("ばびぼ")).toBe("ばびぼ");
    expect(text.normalizeName("Rock\u2019n\u2018Roll")).toBe("rocknroll");
    expect(text.nameTokens("Satoru Gojo")).toEqual(["gojo", "satoru"]);
    expect(text.nameTokens("   ")).toEqual([]);
    expect(oldText.slugify("Café d'Été")).toBe("cafe-dete");
    expect(text.escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });
});

describe("shared/relics", () => {
  it("economy/relics reexporta as regras puras", () => {
    for (const name of [
      "RELIC_KEYS",
      "RELIC_BASE_COST",
      "RELIC_MAX_LEVEL",
      "relicUpgradeCost",
      "relicDiscount",
      "planRelicUpgrade",
      "totalRelicLevels",
      "relicLevelsOf",
      "clampRelicLevel",
    ] as const) {
      expect(oldRelics[name], name).toBe(relics[name]);
    }
  });

  it("custos e plano de evolucao", () => {
    expect(relics.relicUpgradeCost("bronze", 0, 0)).toBe(500);
    expect(relics.relicUpgradeCost("emerald", 3, 0)).toBe(20000);
    expect(relics.relicUpgradeCost("emerald", 3, 4)).toBe(15000);
    expect(relics.relicUpgradeCost("gold", 4, 0)).toBe(12000);
    expect(relics.relicUpgradeCost("gold", 8, 0)).toBeNull();
    const levels = { ...relics.emptyRelicLevels(), ruby: 4, gold: 1 };
    expect(relics.planRelicUpgrade(levels, 10_000, "gold")).toEqual({
      kind: "ok",
      cost: 2250,
      fromLevel: 1,
      toLevel: 2,
      balanceAfter: 7750,
    });
    expect(relics.planRelicUpgrade(levels, 10, "gold").kind).toBe("insufficient");
    expect(relics.planRelicUpgrade({ ...levels, ruby: 8 }, 10, "ruby").kind).toBe("max");
    expect(relics.totalRelicLevels(levels)).toBe(5);
  });
});

describe("shared/guildSettings", () => {
  it("config/service usa os mesmos validadores", () => {
    expect(oldConfig.settingSchemas).toBe(guildSettings.settingSchemas);
    expect(oldConfig.SETTING_LIMITS).toBe(guildSettings.SETTING_LIMITS);
    expect(oldConfig.SETTING_KEYS).toBe(guildSettings.SETTING_KEYS);
  });

  it("validacao e idioma", () => {
    const s = guildSettings.settingSchemas;
    expect(s.rolls.parse("15")).toBe(15);
    expect(s.rolls.safeParse("0").success).toBe(false);
    expect(s.rolls.safeParse("-3").success).toBe(false);
    expect(s.rolls.safeParse(1.5).success).toBe(false);
    expect(s.timer.parse(360)).toBe(360);
    expect(s.timer.safeParse(361).success).toBe(false);
    expect(s.claim.safeParse(9).success).toBe(false);
    expect(s.gamemode.parse("2")).toBe(2);
    expect(s.prefix.parse("!!")).toBe("!!");
    expect(s.prefix.safeParse("a b").success).toBe(false);
    expect(s.prefix.safeParse("a`").success).toBe(false);
    expect(s.prefix.safeParse("abcdef").success).toBe(false);
    expect(s.lang.parse(" PT_br ")).toBe("pt-BR");
    expect(s.lang.parse("EN")).toBe("en-US");
    expect(s.lang.safeParse("fr").success).toBe(false);
  });

  it("patchFor e janelas", () => {
    expect(guildSettings.patchFor("timer", 120)).toEqual({ claimCooldownMinutes: 120 });
    expect(guildSettings.patchFor("rolls", 7)).toEqual({ baseRolls: 7 });
    expect(guildSettings.patchFor("lang", "en-US")).toEqual({ language: "en-US" });
    expect(guildSettings.RESETS_WINDOWS.has("timer")).toBe(true);
    expect(guildSettings.RESETS_WINDOWS.has("rolls")).toBe(false);
    expect(guildSettings.limitsOf("lang")).toEqual({ min: 0, max: 0 });
  });
});

describe("shared/pantheon", () => {
  it("collection/service reexporta pactValueSql e SOULMATE_KEYS", () => {
    expect(oldCollection.pactValueSql).toBe(pantheon.pactValueSql);
    expect(oldCollection.SOULMATE_KEYS).toBe(pantheon.SOULMATE_KEYS);
  });

  it("pactValueSql mantem a expressao", () => {
    const { sql: text } = toSql(pantheon.pactValueSql());
    expect(text).toContain("GREATEST(floor(");
    expect(text).toContain("WHEN 'FOIL' THEN");
    expect(text).toContain('"pacts"."awakening_keys" >= 2');
    expect(text).toContain('"pacts"."aether_at_bind"::bigint');
  });

  it("filtros e ordenacao", () => {
    const base = { sort: "default" as const, terms: [], excluded: [] };
    const plain = toSql(pantheon.pantheonConditions("g", "u", base));
    expect(plain.sql).toBe('("pacts"."guild_id" = $1 and "pacts"."user_id" = $2)');
    expect(plain.params).toEqual(["g", "u"]);

    const full = toSql(
      pantheon.pantheonConditions("g", "u", {
        ...base,
        gender: "FEMALE",
        universe: "ANIME",
        keys: "soulmates",
        terms: ["frieren"],
        excluded: ["naruto"],
      })
    );
    expect(full.params).toEqual(
      expect.arrayContaining(["g", "u", "FEMALE", "ANIME", "%frieren%", "%naruto%"])
    );
    expect(full.sql).toContain('"pacts"."awakening_keys" >= 10');
    expect(full.sql).toContain("not (");

    const value = pantheon.pactValueSql();
    const seriesName = sql`coalesce(1, 2)`;
    expect(pantheon.pantheonOrder("default", value, seriesName)).toHaveLength(3);
    expect(pantheon.pantheonOrder("soulmates", value, seriesName)).toHaveLength(5);
    expect(pantheon.pantheonOrder("aether", value, seriesName)).toHaveLength(3);
  });
});

describe("shared/search", () => {
  it("trigramMatch com LIKE e ILIKE", () => {
    const like = toSql(search.trigramMatch(entities.nameNormalized, "zero two", ["two", "zero"]));
    expect(like.sql).toBe(
      '("entities"."name_normalized" % $1 OR $2 <% "entities"."name_normalized" OR ("entities"."name_normalized" LIKE $3 AND "entities"."name_normalized" LIKE $4))'
    );
    expect(like.params).toEqual(["zero two", "zero two", "%two%", "%zero%"]);
    const ilike = toSql(search.trigramMatch(entities.name, "ab", ["ab"], true));
    expect(ilike.sql).toContain('"entities"."name" ILIKE $3');
  });

  it("trigramScore", () => {
    const q = toSql(search.trigramScore(entities.nameNormalized, "k"));
    expect(q.sql).toBe(
      'GREATEST(similarity("entities"."name_normalized", $1), word_similarity($2, "entities"."name_normalized"))'
    );
  });
});