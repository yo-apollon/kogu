import { describe, expect, it } from "vitest";
import { BRAND_COLOR } from "../../../src/ui/tokens.js";
import { discordRelative, discordTime } from "../../../src/lib/time.js";
import type { MemberSnapshot, PantheonSummary } from "../../../src/modules/economy/extra.js";
import { emptyRelicLevels, RELIC_KEYS } from "../../../src/modules/economy/relics.js";
import type { DailyResult } from "../../../src/modules/economy/service.js";
import {
  dailyEmbed,
  FALLBACK,
  orbUpText,
  pactUpText,
  parseEmbedColor,
  parseTopMode,
  profileOverviewEmbed,
  profileRelicsEmbed,
  profileSections,
  relicButtonId,
  relicButtons,
  relicLines,
  relicsEmbed,
  relicUpgradedEmbed,
  resetLabel,
  rollsUpText,
  timersEmbed,
  tl,
  topEmbed,
  topModeButtonId,
  topModeRow,
} from "../../../src/modules/economy/views.js";
import type { Timers } from "../../../src/modules/summon/service.js";

const ROLLS_RESET = Date.UTC(2026, 0, 1, 11, 0, 0);
const PACT_RESET = Date.UTC(2026, 0, 1, 12, 0, 0);
const DAILY_AT = Date.UTC(2026, 0, 2, 6, 30, 0);

function timers(over: Partial<Timers> = {}): Timers {
  return {
    rolls: { used: 7, limit: 10, remaining: 3, nextResetAt: ROLLS_RESET },
    stacked: 5,
    pacts: { used: 0, limit: 2, remaining: 2, ready: true, nextResetAt: PACT_RESET },
    balance: 12_345,
    daily: { available: true, nextAt: null },
    ...over,
  };
}

const json = (b: { toJSON(): any }) => b.toJSON();
const allText = (b: { toJSON(): any }) => {
  const j = json(b);
  return [
    j.title,
    j.description,
    j.footer?.text,
    ...(j.fields ?? []).flatMap((f: any) => [f.name, f.value]),
  ]
    .filter(Boolean)
    .join("\n");
};

describe("tl (i18n com reserva)", () => {
  it("usa o locale quando a chave existe e a reserva quando nao existe", () => {
    expect(tl("economy.balance", "pt-BR", { value: "X" })).toContain("Saldo");
    expect(tl("economy.timers_daily_title", "pt-BR")).toBe(
      FALLBACK["pt-BR"]["economy.timers_daily_title"]
    );
    expect(tl("economy.timers_daily_title", "en-US")).toBe("🎁 Daily Bonus");
    expect(tl("economy.timers_daily_ready", "pt-BR", { prefix: "!" })).toContain("`!daily`");
  });

  it("chave sem locale e sem reserva devolve a propria chave", () => {
    expect(tl("economy.nao_existe", "pt-BR")).toBe("economy.nao_existe");
  });

  it("toda reserva tem texto nos dois idiomas", () => {
    expect(Object.keys(FALLBACK["en-US"]).sort()).toEqual(Object.keys(FALLBACK["pt-BR"]).sort());
  });
});

describe("timersEmbed", () => {
  const view = (tm: Timers) =>
    timersEmbed({ timers: tm, locale: "pt-BR", prefix: "$", userName: "Ana" });

  it("mostra rolls restantes/maximo e o horario EXATO do reset (relativo + hora)", () => {
    const embed = view(timers());
    const text = allText(embed);
    expect(text).toContain("**3/10**");
    expect(text).toContain(discordRelative(ROLLS_RESET));
    expect(text).toContain(discordTime(ROLLS_RESET, "t"));
    expect(resetLabel(ROLLS_RESET)).toBe(
      `${discordRelative(ROLLS_RESET)} · ${discordTime(ROLLS_RESET, "t")}`
    );
  });

  it("mostra empilhados, cargas de pacto, saldo e daily disponivel", () => {
    const embed = view(timers());
    const text = allText(embed);
    expect(text).toContain("**5** extras");
    expect(text).toContain("Cargas: **2/2**");
    expect(text).toContain("Disponível para firmar Pacto agora");
    expect(text).toContain("12.345");
    expect(text).toContain("`$daily`");
    expect(json(embed).title).toContain("Ana");
  });

  it("pacto esgotado mostra o reset; daily em cooldown mostra o proximo resgate", () => {
    const embed = view(
      timers({
        pacts: { used: 2, limit: 2, remaining: 0, ready: false, nextResetAt: PACT_RESET },
        daily: { available: false, nextAt: DAILY_AT },
      })
    );
    const text = allText(embed);
    expect(text).toContain(discordRelative(PACT_RESET));
    expect(text).toContain("Cargas: **0/2**");
    expect(text).toContain(discordRelative(DAILY_AT));
    expect(text).not.toContain("Disponível para firmar Pacto agora");
  });

  it("escapa markdown do nome", () => {
    expect(
      json(timersEmbed({ timers: timers(), locale: "pt-BR", prefix: "$", userName: "*x*" })).title
    ).toContain("\\*x\\*");
  });

  it("en-US usa o idioma pedido (com reserva para chaves novas)", () => {
    const text = allText(
      timersEmbed({ timers: timers(), locale: "en-US", prefix: "!", userName: "Bob" })
    );
    expect(text).toContain("Charges: **2/2**");
    expect(text).toContain("`!daily`");
  });
});

describe("respostas rapidas ($mu, $ru, $ku)", () => {
  const input = { timers: timers(), locale: "pt-BR" as const, userName: "Ana" };

  it("$mu: pronto e aguardando", () => {
    expect(pactUpText(input)).toContain("pode firmar um Pacto agora");
    const waiting = pactUpText({
      ...input,
      timers: timers({
        pacts: { used: 1, limit: 1, remaining: 0, ready: false, nextResetAt: PACT_RESET },
      }),
    });
    expect(waiting).toContain("recarregando");
    expect(waiting).toContain(discordRelative(PACT_RESET));
  });

  it("$ru: rolls, reset exato e empilhados", () => {
    const text = rollsUpText(input);
    expect(text).toContain("**3/10**");
    expect(text).toContain(discordRelative(ROLLS_RESET));
    expect(text).toContain("**5**");
  });

  it("$ku", () => {
    expect(orbUpText(input)).toContain("Orbes de Éter");
  });
});

describe("dailyEmbed", () => {
  const result: DailyResult = {
    reward: 412,
    stackedAdded: 5,
    balance: 1912,
    stackedRolls: 5,
    nextAt: DAILY_AT,
  };

  it("resume o resgate e informa o proximo horario", () => {
    const embed = dailyEmbed({ result, baseRolls: 10, locale: "pt-BR" });
    const text = allText(embed);
    expect(json(embed).title).toContain("Bônus Dimensional Diário");
    expect(text).toContain("+412 Éter");
    expect(text).toContain("+5 Invocações Empilhadas");
    expect(text).toContain("10/10");
    expect(text).toContain("1.912");
    expect(text).toContain(discordRelative(DAILY_AT));
  });
});

describe("reliquias", () => {
  const levels = { ...emptyRelicLevels(), bronze: 2, ruby: 8, emerald: 8 };

  it("lista as 6 reliquias com barra, comando e efeito", () => {
    const lines = relicLines(levels, "pt-BR", "!");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("Relíquia de Bronze");
    expect(lines[0]).toContain("🟩🟩⬛⬛");
    expect(lines[0]).toContain("Nv.2/8");
    expect(lines[0]).toContain("`!k bronze`");
    expect(lines[5]).toContain("🟩🟩🟩🟩🟪🟪🟪🟪");
  });

  it("embed do altar traz saldo e a introducao; somente leitura omite a introducao", () => {
    const base = { userName: "Ana", balance: 2500, levels, locale: "pt-BR" as const, prefix: "$" };
    const full = allText(relicsEmbed(base));
    expect(full).toContain("Altar de Relíquias de Ana");
    expect(full).toContain("2.500");
    expect(full).toContain("`$k bronze`");
    const readonly = allText(relicsEmbed({ ...base, interactive: false }));
    expect(readonly).not.toContain("Seu Saldo");
  });

  it("botoes: um por reliquia, 3 por linha, customId valido e custo no rotulo", () => {
    const rows = relicButtons({
      levels,
      balance: 700,
      ownerId: "123456789012345678",
      locale: "pt-BR",
    });
    expect(rows).toHaveLength(2);
    const buttons = rows.flatMap((r) => r.toJSON().components as any[]);
    expect(buttons).toHaveLength(6);
    expect(rows.every((r) => (r.toJSON().components as any[]).length <= 5)).toBe(true);
    expect(buttons.map((b) => b.custom_id)).toEqual(
      RELIC_KEYS.map((k) => `ec:rl:${k}:123456789012345678`)
    );
    for (const b of buttons) expect(b.custom_id.length).toBeLessThanOrEqual(100);

    // ruby 8 => -35%: bronze nivel 2 custa 1500 * .65 = 975 (sem saldo: Secondary)
    const bronze = buttons[0];
    expect(bronze.label).toContain("975");
    expect(bronze.style).toBe(2); // Secondary (saldo 700 < 975)
    expect(bronze.disabled).toBe(false);
    // silver nivel 0: 1000 * .65 = 650 <= 700; prata fica Success
    expect(buttons[1].label).toContain("650");
    // ruby e esmeralda no maximo (8): desligados e com MAX
    expect(buttons[4]).toMatchObject({ label: "MAX", disabled: true });
    expect(buttons[5]).toMatchObject({ label: "MAX", disabled: true });
  });

  it("botao acessivel fica verde (Success)", () => {
    const rows = relicButtons({
      levels: emptyRelicLevels(),
      balance: 10_000,
      ownerId: "42",
      locale: "pt-BR",
    });
    const buttons = rows.flatMap((r) => r.toJSON().components as any[]);
    expect(buttons.every((b) => b.style === 3 && b.disabled === false)).toBe(true);
    expect(relicButtonId("gold", "42")).toBe("ec:rl:gold:42");
  });

  it("mensagem de evolucao", () => {
    const text = allText(
      relicUpgradedEmbed({ key: "gold", toLevel: 3, balance: 4200, locale: "pt-BR" })
    );
    expect(text).toContain("Relíquia de Ouro");
    expect(text).toContain("Nível 3/8");
    expect(text).toContain("4.200");
  });
});

describe("perfil", () => {
  const member: MemberSnapshot = {
    exists: true,
    balance: 8800,
    astralShards: 3,
    embedColor: "#E879F9",
    relics: { ...emptyRelicLevels(), gold: 2 },
  };
  const pantheon: PantheonSummary = {
    count: 7,
    awakeningKeys: 14,
    soulmates: 1,
    worth: 5400,
    leader: { name: "Zero Two", franchise: "Darling", imageUrl: "https://x/z.png", aether: 640 },
  };
  const view = {
    userName: "Ana",
    avatarUrl: "https://cdn/avatar.png",
    member,
    pantheon,
    locale: "pt-BR" as const,
    prefix: "$",
  };

  it("visao geral: saldo, patrimonio, shards, pactos, lider e reliquias", () => {
    const embed = profileOverviewEmbed(view);
    const j = json(embed);
    const text = allText(embed);
    expect(j.title).toContain("Ana");
    expect(j.color).toBe(0xe879f9);
    expect(j.thumbnail.url).toBe("https://x/z.png");
    expect(text).toContain("8.800");
    expect(text).toContain("5.400");
    expect(text).toContain("Fragmentos Astrais: **3**");
    expect(text).toContain("Entidades Seladas: **7**");
    expect(text).toContain("Selos de Despertar (★): **14**");
    expect(text).toContain("Almas Gêmeas (★10+): **1**");
    expect(text).toContain("Zero Two");
    expect(text).toContain("Darling");
    expect(text).toContain("Ouro (Nível 2/4)");
    expect(text).toContain("Bronze (Nível 0/4)");
  });

  it("sem lider usa o avatar e o texto vazio; cor invalida cai na marca", () => {
    const embed = profileOverviewEmbed({
      ...view,
      member: { ...member, embedColor: "roxo" },
      pantheon: { ...pantheon, count: 0, leader: null },
    });
    const j = json(embed);
    expect(j.thumbnail.url).toBe("https://cdn/avatar.png");
    expect(allText(embed)).toContain("Nenhuma entidade ainda");
    expect(j.color).toBe(BRAND_COLOR);
  });

  it("secoes do painel: Visao geral e Reliquias (somente leitura, com a cor do jogador)", async () => {
    const sections = profileSections(view);
    expect(sections.map((s) => s.id)).toEqual(["overview", "relics"]);
    expect(sections.map((s) => s.label)).toEqual(["Visão geral", "Relíquias"]);
    const relics = (await sections[1]!.render()) as { embeds: Array<{ toJSON(): any }> };
    expect(json(relics.embeds[0]!).color).toBe(0xe879f9);
    expect(allText(relics.embeds[0]!)).not.toContain("Seu Saldo");
    expect(allText(profileRelicsEmbed(view))).toContain("Relíquia de Ouro");
  });

  it("parseEmbedColor", () => {
    expect(parseEmbedColor("#5865F2")).toBe(0x5865f2);
    expect(parseEmbedColor("00ff00")).toBe(0x00ff00);
    expect(parseEmbedColor("#xyz")).toBe(BRAND_COLOR);
    expect(parseEmbedColor(null)).toBe(BRAND_COLOR);
  });
});

describe("ranking", () => {
  const rows = [
    { rank: 1, userId: "111111111111111111", value: 9000 },
    { rank: 2, userId: "222222222222222222", value: 1200 },
  ];

  it("por Eter: mencoes, posicao e valor formatado", () => {
    const embed = topEmbed({ mode: "aether", rows, page: 1, totalPages: 3, locale: "pt-BR" });
    const j = json(embed);
    expect(j.title).toContain("Ranking Dimensional do Servidor");
    expect(j.description).toContain("**#1** <@111111111111111111> — **9.000 Éter 💠**");
    expect(j.description).toContain("**#2** <@222222222222222222>");
    expect(j.footer.text).toBe("Página 1/3");
  });

  it("por pactos: pluraliza (1 pacto / N pactos)", () => {
    const embed = topEmbed({
      mode: "pacts",
      rows: [
        { rank: 11, userId: "333333333333333333", value: 1 },
        { rank: 12, userId: "444444444444444444", value: 14 },
      ],
      page: 2,
      totalPages: 2,
      locale: "pt-BR",
    });
    const j = json(embed);
    expect(j.title).toContain("Ranking de Pactos");
    expect(j.description).toContain("**#11** <@333333333333333333> — **1 pacto**");
    expect(j.description).toContain("**#12** <@444444444444444444> — **14 pactos**");
  });

  it("vazio mostra a mensagem padrao", () => {
    const embed = topEmbed({ mode: "aether", rows: [], page: 1, totalPages: 1, locale: "pt-BR" });
    expect(json(embed).description).toContain("Nenhum jogador registrado");
  });

  it("linha de criterio: atual desligado, outro ativo; customIds com o dono", () => {
    const row = topModeRow({ mode: "pacts", ownerId: "99", locale: "pt-BR" }).toJSON();
    const [aether, pacts] = row.components as any[];
    expect(aether).toMatchObject({ custom_id: "ec:top:aether:99", disabled: false, style: 2 });
    expect(pacts).toMatchObject({ custom_id: "ec:top:pacts:99", disabled: true, style: 1 });
    expect(topModeButtonId("aether", "99")).toBe("ec:top:aether:99");
  });

  it("parseTopMode aceita apelidos", () => {
    expect(parseTopMode("PACTOS")).toBe("pacts");
    expect(parseTopMode("pacts")).toBe("pacts");
    expect(parseTopMode("eter")).toBe("aether");
    expect(parseTopMode("éter")).toBe("aether");
    expect(parseTopMode("xyz")).toBeUndefined();
    expect(parseTopMode(undefined)).toBeUndefined();
  });
});
