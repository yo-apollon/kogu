import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TMDB_ATTRIBUTION } from "../../../src/catalog/sources/tmdb.js";
import type { AnyCommand, CommandCategory } from "../../../src/core/contracts.js";
import { CommandRegistry } from "../../../src/core/registry.js";
import { handlePanelInteraction } from "../../../src/ui/components/panel.js";
import { commands as adminCommands } from "../../../src/modules/admin/index.js";
import { commands as catalogCommands } from "../../../src/modules/catalog/index.js";
import { createHelpCommand, helpCommand } from "../../../src/modules/help/commands.js";
import { commands, components } from "../../../src/modules/help/index.js";
import { FALLBACK_MESSAGES, msg, tmdbAttribution } from "../../../src/modules/help/messages.js";
import {
  CATEGORY_ORDER,
  buildHelpGroups,
  describeCommand,
  toEntry,
} from "../../../src/modules/help/service.js";
import {
  OVERVIEW_SECTION_ID,
  buildHelpSections,
  categoryEmbeds,
  chunkLines,
  commandLine,
  helpFooter,
  overviewEmbed,
} from "../../../src/modules/help/views.js";
import { pingCommands } from "../../../src/modules/ping/commands.js";
import { FakeKV, flattenComponents, mockSelect } from "../ui/helpers.js";
import { guildConfig } from "../core/helpers.js";

const cmd = (
  name: string,
  category: CommandCategory,
  extra: Partial<AnyCommand> = {}
): AnyCommand => ({
  name,
  category,
  descriptionKey: `help.commands.${name}`,
  async execute() {},
  ...extra,
});

const sample: AnyCommand[] = [
  cmd("import", "catalog", { aliases: ["add", "importar"], slash: (() => ({})) as never }),
  cmd("daily", "economy", { aliases: ["dk", "dailykakera", "diario", "rolls"] }),
  cmd("setvip", "admin", { ownerOnly: true }),
  cmd("summon", "summon"),
  cmd("summon_waifu", "summon", { descriptionKey: "help.commands.summon_waifu" }),
  cmd("ping", "help"),
  cmd("misterio", "help", { descriptionKey: "help.commands.nao_existe" }),
];

const embedJson = (e: { toJSON(): any }) => e.toJSON();

describe("registro do modulo", () => {
  it("exporta help com aliases ajuda/comandos e sem componentes proprios", () => {
    expect(commands.map((c) => c.name)).toEqual(["help"]);
    expect(components).toEqual([]);
    const registry = new CommandRegistry();
    registry.register(helpCommand);
    expect(registry.get("ajuda")?.name).toBe("help");
    expect(registry.get("comandos")?.name).toBe("help");
    const [slash] = registry.buildSlashPayload();
    expect(slash.name).toBe("help");
    expect(slash.description).toBe("Mostra a central de ajuda.");
    expect((slash.description_localizations as any)["en-US"]).toBe("Shows the help hub.");
    expect(helpCommand.category).toBe("help");
  });
});

describe("buildHelpGroups", () => {
  it("agrupa por categoria na ordem do help, omite vazias e mantem a ordem de registro", () => {
    const groups = buildHelpGroups(sample, "pt-BR", "$");
    expect(groups.map((g) => g.category)).toEqual(["summon", "economy", "catalog", "admin", "help"]);
    expect(groups[0].entries.map((e) => e.name)).toEqual(["summon", "summon_waifu"]);
    expect(groups[0].title).toBe("🎲 Roleta de Invocação");
    expect(groups.find((g) => g.category === "admin")!.title).toBe("🛡️ Moderação (Staff)");
  });

  it("categoria desconhecida vai para o fim com o proprio nome", () => {
    const odd = cmd("x", "ghost" as CommandCategory);
    const groups = buildHelpGroups([odd, ...sample], "pt-BR", "$");
    expect(groups.at(-1)).toMatchObject({ category: "ghost", title: "ghost" });
    expect(CATEGORY_ORDER).toHaveLength(8);
  });

  it("usage com prefixo do servidor e aliases (limitados a 3)", () => {
    const entries = Object.fromEntries(
      buildHelpGroups(sample, "pt-BR", "!").flatMap((g) => g.entries.map((e) => [e.name, e]))
    );
    expect(entries.import.usage).toBe("!import (!add, !importar)");
    expect(entries.daily.usage).toBe("!daily (!dk, !dailykakera, !diario, …)");
    expect(entries.summon.usage).toBe("!summon");
    expect(entries.setvip.ownerOnly).toBe(true);
    expect(entries.import.slash).toBe(true);
    expect(entries.summon.slash).toBe(false);
  });

  it("descricao vem de help.commands.* no idioma, com fallback local e vazio quando nao ha", () => {
    expect(describeCommand(cmd("import", "catalog"), "pt-BR")).toBe(
      "Importa um personagem do AniList para o catálogo."
    );
    expect(describeCommand(cmd("import", "catalog"), "en-US")).toBe(
      "Imports a character from AniList into the catalog."
    );
    // ping e catalog ainda nao estao nos locales: fallback local
    expect(describeCommand(cmd("ping", "help"), "pt-BR")).toBe("Mostra a latência do bot.");
    expect(describeCommand(cmd("catalog", "catalog"), "en-US")).toContain("Catalog moderation");
    expect(describeCommand(cmd("misterio", "help", { descriptionKey: "help.commands.nao_existe" }), "pt-BR")).toBe("");
    expect(toEntry(cmd("ping", "help"), "pt-BR", "$").description).toBe("Mostra a latência do bot.");
  });
});

describe("views", () => {
  it("linha de comando: formato do locale, cadeado para owner e so o uso se nao ha descricao", () => {
    const entries = Object.fromEntries(
      buildHelpGroups(sample, "pt-BR", "$").flatMap((g) => g.entries.map((e) => [e.name, e]))
    );
    expect(commandLine(entries.import, "pt-BR")).toBe(
      "`$import ($add, $importar)` — Importa um personagem do AniList para o catálogo."
    );
    expect(commandLine(entries.setvip, "pt-BR")).toMatch(/^`\$setvip` — .+ 🔒$/);
    expect(commandLine(entries.misterio, "pt-BR")).toBe("`$misterio`");
  });

  it("rodape com prefixo e atribuicao do TMDB (pt-BR exportada do adapter; en-US oficial)", () => {
    const pt = helpFooter("pt-BR", "!");
    expect(pt).toContain("Prefixo: !");
    expect(pt).toContain("AniList");
    expect(pt).toContain("IGDB");
    expect(pt).toContain("TMDB");
    expect(pt).toContain(TMDB_ATTRIBUTION);
    const en = helpFooter("en-US", "$");
    expect(en).toContain(tmdbAttribution("en-US"));
    expect(en).toContain("not endorsed or certified by TMDB");
    expect(pt.length).toBeLessThanOrEqual(2048);
  });

  it("visao geral lista as categorias e a quantidade; toda tela leva o rodape de atribuicao", () => {
    const groups = buildHelpGroups(sample, "pt-BR", "$");
    const overview = embedJson(overviewEmbed(groups, "pt-BR", "$"));
    expect(overview.title).toBe("🌌 Central Dimensional — Comandos do Arqon");
    expect(overview.description).toContain("🎲 Roleta de Invocação** — 2 comandos");
    expect(overview.description).toContain("Escolha uma categoria no menu");
    expect(overview.footer.text).toContain(TMDB_ATTRIBUTION);
    for (const g of groups) {
      for (const e of categoryEmbeds(g, "pt-BR", "$")) {
        expect(embedJson(e).footer.text).toContain(TMDB_ATTRIBUTION);
      }
    }
  });

  it("categoria grande vira varios embeds dentro do limite de 4096", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      cmd(`comando${i}`, "summon", { descriptionKey: "help.commands.summon" })
    );
    const [group] = buildHelpGroups(many, "pt-BR", "$");
    const embeds = categoryEmbeds(group, "pt-BR", "$").map(embedJson);
    expect(embeds.length).toBeGreaterThan(1);
    expect(embeds.length).toBeLessThanOrEqual(3);
    for (const e of embeds) expect(e.description.length).toBeLessThanOrEqual(4096);
    expect(embeds[0].title).toBe(group.title);
    expect(embeds[1].title).toBeUndefined();
  });

  it("chunkLines respeita o limite e preserva linhas inteiras", () => {
    expect(chunkLines(["aaaa", "bbbb", "cccc"], 9)).toEqual(["aaaa\nbbbb", "cccc"]);
    expect(chunkLines([], 10)).toEqual([]);
    expect(chunkLines(["x".repeat(20)], 10)).toEqual(["x".repeat(20)]);
  });

  it("secoes: visao geral primeiro e uma por categoria, com descricao do select <= 100", () => {
    const groups = buildHelpGroups(sample, "pt-BR", "$");
    const sections = buildHelpSections(groups, "pt-BR", "$");
    expect(sections.map((s) => s.id)).toEqual([OVERVIEW_SECTION_ID, ...groups.map((g) => g.category)]);
    expect(sections[0].label).toBe("Visão geral");
    expect(sections[1].description).toBe("$summon $summon_waifu");
    for (const s of sections) expect((s.description ?? "").length).toBeLessThanOrEqual(100);
  });
});

describe("fallbacks de i18n", () => {
  it("pt-BR e en-US tem as mesmas chaves e placeholders", () => {
    const pt = FALLBACK_MESSAGES["pt-BR"];
    const en = FALLBACK_MESSAGES["en-US"];
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(pt)) expect(ph(en[k]), k).toEqual(ph(pt[k]));
    expect(msg("pt-BR", "help.nada")).toBe("help.nada");
  });
});

describe("comando /help com painel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeCtx(userId = "u1") {
    const sent: any[] = [];
    const reply = vi.fn(async (payload: unknown) => {
      sent.push(payload);
      return { id: "m1", edit: vi.fn(async () => undefined) };
    });
    return {
      ctx: {
        user: { id: userId },
        guildConfig: guildConfig({ prefix: "!" }),
        locale: "pt-BR",
        reply,
      } as never,
      sent,
      reply,
    };
  }

  it("responde com o select de categorias e troca de secao so para o autor", async () => {
    const kv = new FakeKV();
    const help = createHelpCommand({ getCommands: () => sample, getKV: async () => kv });
    const { ctx, sent } = fakeCtx("u1");
    await help.execute(ctx);

    const payload = sent[0];
    expect((payload.embeds[0] as any).toJSON().title).toContain("Central Dimensional");
    const select = flattenComponents(payload.components)[0];
    expect(select.options.map((o: any) => o.value)).toEqual([
      "overview",
      "summon",
      "economy",
      "catalog",
      "admin",
      "help",
    ]);
    expect(select.placeholder).toBe("Escolha uma categoria");

    // autor escolhe "catalog"
    const pick = mockSelect(select.custom_id, "u1", ["catalog"]);
    await handlePanelInteraction(kv, pick);
    const updated = (pick.update.mock.calls[0] as unknown[])[0] as any;
    const text = updated.embeds[0].toJSON();
    expect(text.title).toBe("📚 Catálogo");
    expect(text.description).toContain("`!import (!add, !importar)`");
    expect(text.footer.text).toContain("Prefixo: !");

    // outro usuario nao consegue
    const intruder = mockSelect(select.custom_id, "u2", ["admin"]);
    await handlePanelInteraction(kv, intruder);
    expect(intruder.update).not.toHaveBeenCalled();
    expect(intruder.reply).toHaveBeenCalled();
  });

  it("le a lista do registry no momento da execucao (nao na criacao)", async () => {
    const kv = new FakeKV();
    const list: AnyCommand[] = [cmd("a", "summon")];
    const help = createHelpCommand({ getCommands: () => list, getKV: async () => kv });
    list.push(cmd("b", "economy"));
    const { ctx, sent } = fakeCtx();
    await help.execute(ctx);
    const select = flattenComponents(sent[0].components)[0];
    expect(select.options.map((o: any) => o.value)).toEqual(["overview", "summon", "economy"]);
  });
});

describe("cobertura dos modulos F10 (catalog, admin, help, ping)", () => {
  it("todo comando desses modulos aparece no help com descricao real (sem chave crua)", () => {
    const all = [...catalogCommands, ...adminCommands, ...commands, ...pingCommands];
    for (const locale of ["pt-BR", "en-US"] as const) {
      const groups = buildHelpGroups(all, locale, "$");
      const entries = groups.flatMap((g) => g.entries);
      expect(entries).toHaveLength(all.length);
      for (const e of entries) {
        expect(e.description, `${locale}:${e.name}`).not.toBe("");
        expect(e.description).not.toMatch(/^help\.commands\./);
      }
    }
  });
});
