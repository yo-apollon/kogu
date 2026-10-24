import { describe, expect, it, vi } from "vitest";
import { hasKey } from "../../../src/i18n/index.js";
import { UserError } from "../../../src/lib/errors.js";
import type {
  AppliedSetting,
  DisabledEntry,
  DisableTarget,
  GuildSettings,
} from "../../../src/modules/config/service.js";
import {
  buildSettingsSections,
  disableAlreadyEmbed,
  disableOkEmbed,
  emptyDisabledEmbed,
  enableOkEmbed,
  FALLBACK_TEXT,
  renderDisabledPage,
  replyFallbackError,
  settingAppliedEmbed,
  SLASH_TEXT,
  targetChoice,
  tr,
} from "../../../src/modules/config/views.js";
import { embedText } from "./helpers.js";

const settings: GuildSettings = {
  id: "g1",
  prefix: "!",
  locale: "en-US",
  gamemode: 2,
  baseRolls: 25,
  rollIntervalMin: 45,
  resetOffsetMin: 15,
  claimCooldownMinutes: 120,
  pactsPerWindow: 2,
  claimWindowSeconds: 30,
  snipeProtectionLevel: 1,
  snipeProtectionSeconds: 6,
  aetherSnipeProtectionLevel: 0,
  aetherSnipeProtectionSeconds: 9,
  pactLimit: 500,
  releaseBoostEnabled: false,
  allowAdult: true,
};

const frieren: DisableTarget = { kind: "series", id: 1, name: "Sousou no Frieren" };

function entries(n: number): DisabledEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: i % 2 === 0 ? ("series" as const) : ("franchise" as const),
    id: i + 1,
    name: `Obra ${i + 1}`,
    serverWide: false,
    createdAt: new Date(0),
  }));
}

describe("tr / FALLBACK_TEXT", () => {
  it("prefere o locale e cai no fallback so quando a chave nao existe", () => {
    expect(tr("pt-BR", "config.setrolls_ok", { value: 9 })).toContain("**9**");
    for (const key of Object.keys(FALLBACK_TEXT)) {
      if (hasKey(key, "pt-BR")) continue;
      expect(tr("pt-BR", key, { series: "X", query: "q", count: 1, prefix: "$" })).not.toBe(key);
    }
    expect(tr("pt-BR", "config.nao_existe")).toBe("config.nao_existe");
  });

  it("todos os fallbacks existem nos dois idiomas e preservam os placeholders", () => {
    for (const [key, texts] of Object.entries(FALLBACK_TEXT)) {
      expect(texts["pt-BR"], key).toBeTruthy();
      expect(texts["en-US"], key).toBeTruthy();
      const holders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(holders(texts["en-US"]), key).toEqual(holders(texts["pt-BR"]));
    }
  });

  it("descricoes de slash cabem em 100 caracteres", () => {
    for (const texts of Object.values(SLASH_TEXT)) {
      for (const [key, value] of Object.entries(texts)) {
        expect(value.length, key).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("replyFallbackError", () => {
  it("so trata UserError cuja chave esta sem locale e tem fallback", async () => {
    const reply = vi.fn(async () => undefined);
    const ctx = { reply, locale: "pt-BR" } as any;
    const missing = new UserError("config.disable_series_not_found", { query: "zzz" });
    const handled = await replyFallbackError(ctx, missing);
    expect(handled).toBe(!hasKey("config.disable_series_not_found", "pt-BR"));
    if (handled) expect(embedText((reply.mock.calls[0] as unknown[])[0])).toContain("zzz");

    expect(await replyFallbackError(ctx, new UserError("config.disable_not_found", { query: "x" }))).toBe(false);
    expect(await replyFallbackError(ctx, new Error("boom"))).toBe(false);
  });
});

describe("settingAppliedEmbed", () => {
  const applied = (key: AppliedSetting["key"], value: unknown): AppliedSetting =>
    ({ key, value, windowsReset: false }) as AppliedSetting;
  const text = (a: AppliedSetting, locale: "pt-BR" | "en-US" = "pt-BR") =>
    embedText({ embeds: [settingAppliedEmbed(locale, a)] });

  it("uma mensagem por configuracao, com o valor", () => {
    expect(text(applied("rolls", 15))).toContain("**15**");
    expect(text(applied("timer", 120))).toContain("120 minutos");
    expect(text(applied("claim", 60))).toContain("60 segundos");
    expect(text(applied("gamemode", 2))).toContain("Modo 2");
    expect(text(applied("prefix", "!!"))).toContain("`!!`");
    expect(text(applied("lang", "en-US"), "en-US")).toContain("Server language updated to **en-US**");
    expect(text(applied("lang", "pt-BR"), "pt-BR")).toContain("pt-BR");
  });
});

describe("embeds de desativar", () => {
  it("usuario x servidor", () => {
    const user = embedText({ embeds: [disableOkEmbed("pt-BR", frieren, false)] });
    expect(user).toContain("Sousou no Frieren");
    expect(user).toContain("suas invocações");
    const server = embedText({ embeds: [disableOkEmbed("pt-BR", frieren, true)] });
    expect(server).toContain("Sousou no Frieren");
    expect(server).not.toContain("suas invocações");
    expect(embedText({ embeds: [disableAlreadyEmbed("pt-BR", frieren)] })).toContain("Sousou no Frieren");
    expect(embedText({ embeds: [enableOkEmbed("pt-BR", "Fate/Zero", false)] })).toContain("reativada");
    expect(embedText({ embeds: [enableOkEmbed("en-US", "Fate/Zero", true)] })).toContain("Fate/Zero");
  });

  it("escapa markdown no nome", () => {
    expect(embedText({ embeds: [disableOkEmbed("pt-BR", { ...frieren, name: "A_*B*" }, false)] })).toContain(
      "A\\_\\*B\\*"
    );
  });

  it("lista vazia mostra o prefixo (usuario) ou a mensagem do servidor", () => {
    expect(embedText({ embeds: [emptyDisabledEmbed("pt-BR", "%", false)] })).toContain("%disable");
    expect(embedText({ embeds: [emptyDisabledEmbed("pt-BR", "%", true)] })).toContain("servidor");
  });
});

describe("renderDisabledPage", () => {
  const view = { locale: "pt-BR" as const, prefix: "$", serverWide: false, pageSize: 15 };

  it("numera, diferencia serie de franquia e mostra a contagem total", () => {
    const text = embedText(renderDisabledPage(entries(2), 1, 1, 2, view));
    expect(text).toContain("(2)");
    expect(text).toContain("1. 📜 **Obra 1**");
    expect(text).toContain("2. 📋 **Obra 2**");
    expect(text).toContain("$antidisable");
    expect(text).not.toContain("Página");
  });

  it("continua a numeracao nas paginas seguintes e mostra o indicador", () => {
    const text = embedText(renderDisabledPage(entries(1), 2, 3, 31, view));
    expect(text).toContain("16. 📜 **Obra 1**");
    expect(text).toContain("Página 2/3");
    expect(text).toContain("(31)");
  });

  it("titulo do servidor", () => {
    const user = embedText(renderDisabledPage(entries(1), 1, 1, 1, view));
    const server = embedText(renderDisabledPage(entries(1), 1, 1, 1, { ...view, serverWide: true }));
    expect(server).not.toBe(user);
    expect(server).toContain("(1)");
  });
});

describe("targetChoice", () => {
  it("valor s:N / f:N e icone por tipo", () => {
    expect(targetChoice(frieren)).toEqual({ name: "📜 Sousou no Frieren", value: "s:1" });
    expect(targetChoice({ kind: "franchise", id: 8, name: "Fate" })).toEqual({
      name: "📋 Fate",
      value: "f:8",
    });
  });
});

describe("painel /settings", () => {
  const deps = (over: Partial<Parameters<typeof buildSettingsSections>[0]> = {}) => ({
    locale: "pt-BR" as const,
    guildName: "Meu *Servidor*",
    load: vi.fn(async () => settings),
    loadServerDisabled: vi.fn(async () => [] as DisabledEntry[]),
    ...over,
  });
  const renderText = async (sections: ReturnType<typeof buildSettingsSections>, id: string) => {
    const content = await sections.find((s) => s.id === id)!.render();
    return embedText(content);
  };

  it("secoes na ordem esperada, ate 25 e com ids unicos", () => {
    const sections = buildSettingsSections(deps());
    expect(sections.map((s) => s.id)).toEqual([
      "overview",
      "rolls",
      "timers",
      "locale",
      "advanced",
      "disabled",
    ]);
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
    for (const s of sections) expect(s.label.length).toBeGreaterThan(0);
  });

  it("visao geral mostra toda a configuracao do servidor", async () => {
    const text = await renderText(buildSettingsSections(deps()), "overview");
    expect(text).toContain("Meu \\*Servidor\\*");
    // prefixo, rolls e modo
    expect(text).toContain("`!`");
    expect(text).toContain("`25`");
    expect(text).toContain("Modo `2`");
    // janela de pacto, recarga e snipe
    expect(text).toContain("`30s`");
    expect(text).toContain("`120 min`");
    expect(text).toContain("`6s`");
    // idioma e limite
    expect(text).toContain("`en-US`");
    expect(text).toContain("`500`");
    // avancado
    expect(text).toContain("`45 min`");
    expect(text).toContain("`15 min`");
    expect(text).toContain("`2`");
    expect(text).toContain("`9s`");
    expect(text).toContain("`Não`");
    expect(text).toContain("`Sim`");
    expect(text).toContain("!setrolls 15");
  });

  it("cada secao mostra so o seu grupo e le a config fresca a cada troca", async () => {
    const load = vi.fn(async () => settings);
    const d = { load };
    const sections = buildSettingsSections(deps({ load }));
    const rolls = await renderText(sections, "rolls");
    expect(rolls).toContain("`25`");
    expect(rolls).not.toContain("`120 min`");
    const timers = await renderText(sections, "timers");
    expect(timers).toContain("`120 min`");
    expect(timers).not.toContain("`25`");
    expect(d.load).toHaveBeenCalledTimes(2);

    d.load.mockResolvedValueOnce({ ...settings, baseRolls: 40 });
    expect(await renderText(sections, "rolls")).toContain("`40`");
  });

  it("secao de series desativadas: vazia e com itens (limitada)", async () => {
    const empty = await renderText(buildSettingsSections(deps()), "disabled");
    expect(empty).toContain("servidor");

    const many = entries(25).map((e) => ({ ...e, serverWide: true }));
    const text = await renderText(
      buildSettingsSections(deps({ loadServerDisabled: vi.fn(async () => many) })),
      "disabled"
    );
    expect(text).toContain("(25)");
    expect(text).toContain("1. 📜 **Obra 1**");
    expect(text).toContain("20. 📋 **Obra 20**");
    expect(text).not.toContain("21. ");
    expect(text).toContain("+5");
  });

  it("en-US traduz titulos e usa o fallback no restante", async () => {
    const sections = buildSettingsSections(deps({ locale: "en-US" }));
    const text = await renderText(sections, "overview");
    expect(text).toContain("Dimensional Server Settings");
    expect(text).toContain("Language & Economy");
    expect(sections[0]!.label.length).toBeGreaterThan(0);
  });
});
