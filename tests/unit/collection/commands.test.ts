import { beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
}));
vi.mock("../../../src/lib/logger.js", () => ({ logger: logMock, childLogger: () => logMock }));
vi.mock("../../../src/infra/db/client.js", () => ({ db: {}, sql: {} }));

const kvHolder = vi.hoisted(() => ({ kv: null as unknown }));
vi.mock("../../../src/infra/redis/client.js", () => ({ getKV: async () => kvHolder.kv }));

const canvasMock = vi.hoisted(() => ({ renderCardInPool: vi.fn() }));
vi.mock("../../../src/canvas/index.js", () => canvasMock);

const confirmMock = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("../../../src/ui/components/confirm.js", () => confirmMock);

const safeFetchMock = vi.hoisted(() => ({ safeFetchImage: vi.fn() }));
vi.mock("../../../src/lib/http/safeFetch.js", () => safeFetchMock);

const svc = vi.hoisted(() => ({
  listPantheon: vi.fn(),
  findOwnPact: vi.fn(),
  searchOwnPacts: vi.fn(),
  autocompleteEntities: vi.fn(),
  findEntityId: vi.fn(),
  getEntityInfo: vi.fn(),
  giveEntity: vi.fn(),
  setLeader: vi.fn(),
  setPactText: vi.fn(),
  setPactCustomImage: vi.fn(),
  dissolveOwnPact: vi.fn(),
  resolveEditionForInfo: vi.fn(),
  getEntityImages: vi.fn(),
}));
vi.mock("../../../src/modules/collection/service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/modules/collection/service.js")>()),
  ...svc,
}));

import type { ChatInputCommandInteraction, Message } from "discord.js";
import type { AnyCommand } from "../../../src/core/contracts.js";
import { createPrefixContext, createSlashContext } from "../../../src/core/context.js";
import { parsePrefixInput } from "../../../src/core/prefixRouter.js";
import { CommandRegistry } from "../../../src/core/registry.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { formatNumber } from "../../../src/ui/format.js";
import {
  aliasCommand,
  commands,
  custompicCommand,
  dissolveCommand,
  firstmarryCommand,
  giveCommand,
  infoCommand,
  noteCommand,
  pantheonCommand,
  registrations,
  splitNameAndText,
} from "../../../src/modules/collection/commands.js";
import { components } from "../../../src/modules/collection/index.js";
import type { EntityInfo, OwnPact, PantheonRow } from "../../../src/modules/collection/service.js";
import { embedText, fakeMessage, fakeSlash, guildConfig } from "../core/helpers.js";

const ME = "111111111111111111";
const BOB = "222222222222222222";
const DANA = "333333333333333333";

const registry = new CommandRegistry();
for (const r of registrations) registry.register(r);

const user = (id: string, name: string, bot = false) => ({
  id,
  username: name,
  displayName: name,
  bot,
});

function prefixCtx(
  content: string,
  opts: { mentions?: ReturnType<typeof user>[]; userId?: string } = {}
) {
  const parsed = parsePrefixInput(content, "$")!;
  const reg = registry.resolve(parsed.name)!;
  const m = fakeMessage({ content, userId: opts.userId ?? ME });
  Object.assign(m.message.author, { username: "Alice", displayName: "Alice" });
  (m.message as any).mentions = { users: new Map((opts.mentions ?? []).map((u) => [u.id, u])) };
  const ctx = createPrefixContext(
    m.message as Message<true>,
    reg.cmd,
    parsed.tokens,
    guildConfig(),
    parsed.name
  );
  return { ctx, cmd: reg.cmd, m };
}

async function run(content: string, opts: Parameters<typeof prefixCtx>[1] = {}) {
  const { ctx, cmd, m } = prefixCtx(content, opts);
  await cmd.execute(ctx);
  return m;
}

async function runError(content: string, opts: Parameters<typeof prefixCtx>[1] = {}) {
  const { ctx, cmd } = prefixCtx(content, opts);
  return cmd.execute(ctx).then(
    () => {
      throw new Error("deveria ter lancado");
    },
    (e: { key: string; params: Record<string, unknown> }) => e
  );
}

/** Contexto de slash sem amarrar o tipo dos argumentos (cada comando tem o seu schema). */
const slashCtx = (interaction: ChatInputCommandInteraction, cmd: AnyCommand): any =>
  createSlashContext(interaction, cmd, guildConfig());

const payloadOf = (m: ReturnType<typeof fakeMessage>, call = 0) =>
  m.reply.mock.calls[call]![0] as any;

const pantheonRow = (id: number, name: string, extra: Partial<PantheonRow> = {}): PantheonRow => ({
  pactId: id,
  entityId: id,
  name,
  gender: "FEMALE",
  tier: "COMMON",
  variant: "STANDARD",
  awakeningKeys: 1,
  isSoulmate: false,
  alias: null,
  alias2: null,
  baseAether: 100,
  claimRank: null,
  likeRank: null,
  seriesTitle: "Darling in the Franxx",
  value: 100,
  ...extra,
});

const ownPact = (extra: Partial<OwnPact> = {}): OwnPact => ({
  pactId: 55,
  entityId: 7,
  name: "Zero Two",
  variant: "STANDARD",
  awakeningKeys: 1,
  aetherAtBind: 0,
  baseAether: 380,
  value: 1234,
  ...extra,
});

const entityInfo = (extra: Partial<EntityInfo> = {}): EntityInfo => ({
  id: 7,
  name: "Zero Two",
  universe: "ANIME",
  gender: "FEMALE",
  tier: "EPIC",
  baseAether: 380,
  baseAtk: 90,
  baseDef: 70,
  baseSpd: 85,
  popularityRank: 12,
  claimRank: 3,
  likeRank: 4,
  imageUrl: "https://s4.anilist.co/x.png",
  seriesTitle: "Darling in the Franxx",
  pact: null,
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  kvHolder.kv = new MemoryStore();
  // Sem edicoes por padrao: o $im usa a entidade encontrada.
  svc.resolveEditionForInfo.mockImplementation(async (_g: string, _u: string, id: number) => ({ entityId: id, editions: [] }));
  svc.getEntityImages.mockResolvedValue([]);
  safeFetchMock.safeFetchImage.mockResolvedValue({ buffer: Buffer.from("png"), contentType: "image/png" });
  canvasMock.renderCardInPool.mockResolvedValue(Buffer.from("webp"));
  confirmMock.confirm.mockImplementation(async (o: any) => {
    await o.send({ embeds: [], components: [] });
    return true;
  });
});

// ---------------------------------------------------------------------------

describe("registro: todo alias do messageHandler legado resolve", () => {
  const table: Array<[string, string]> = [
    // $pt $p $pantheon $mm $mymarry e sufixos de flags
    ["pt", "pantheon"],
    ["p", "pantheon"],
    ["pantheon", "pantheon"],
    ["mm", "pantheon"],
    ["mymarry", "pantheon"],
    ["ptk=", "pantheon"],
    ["ptw", "pantheon"],
    ["pth", "pantheon"],
    ["pty", "pantheon"],
    ["pty!=", "pantheon"],
    ["mmw", "pantheon"],
    ["PTWK=", "pantheon"],
    // $im $info $infomarry $ima
    ["im", "info"],
    ["info", "info"],
    ["infomarry", "info"],
    ["ima", "info"],
    // $dissolve $divorce $divorcio
    ["dissolve", "dissolve"],
    ["divorce", "dissolve"],
    ["divorcio", "dissolve"],
    // $firstmarry $fm
    ["firstmarry", "firstmarry"],
    ["fm", "firstmarry"],
    // $give $dar
    ["give", "give"],
    ["dar", "give"],
    // $note $nota $alias $alias2
    ["note", "note"],
    ["nota", "note"],
    ["alias", "alias"],
    ["alias2", "alias"],
  ];

  it.each(table)("%s -> %s", (token, name) => {
    expect(registry.resolve(token)?.cmd.name).toBe(name);
  });

  it("nao captura comandos desconhecidos parecidos", () => {
    for (const token of ["ptz", "ptsomething", "pantheonx", "mymarryk", "xyz", "aliases"]) {
      expect(registry.resolve(token), token).toBeUndefined();
    }
  });

  it("exporta os mesmos comandos em commands e registrations; componentes de trade", () => {
    expect(registrations.map((r) => r.cmd)).toEqual(commands);
    expect(registrations.filter((r) => r.matcher)).toHaveLength(1);
    expect(components.map((c) => c.namespace)).toEqual(["tr", "col"]);
    expect(commands.map((c) => c.name).sort()).toEqual(
      [
        "alias",
        "changeimg",
        "custompic",
        "dissolve",
        "embedcolor",
        "firstmarry",
        "give",
        "info",
        "note",
        "pantheon",
        "sortmarry",
        "trade",
      ].sort()
    );
  });
});

describe("slash: payload valido", () => {
  const payload = registry.buildSlashPayload();
  const byName = new Map(payload.map((p) => [p.name, p]));

  it("registra os slash com descricao pt-BR e en-US", () => {
    expect([...byName.keys()].sort()).toEqual(
      [
        "alias",
        "changeimg",
        "custompic",
        "dissolve",
        "embedcolor",
        "firstmarry",
        "give",
        "info",
        "note",
        "pantheon",
        "sortmarry",
        "trade",
      ].sort()
    );
    for (const p of payload) {
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.description.length).toBeLessThanOrEqual(100);
      expect(p.description_localizations?.["en-US"]).toBeTruthy();
    }
  });

  it("opcoes: nomes validos, descricoes <= 100, obrigatorias antes das opcionais, choices <= 25", () => {
    const nameRe = /^[-_\p{L}\p{N}]{1,32}$/u;
    for (const p of payload) {
      const options = (p.options ?? []) as any[];
      let seenOptional = false;
      for (const o of options) {
        expect(o.name, `${p.name}.${o.name}`).toMatch(nameRe);
        expect(o.name).toBe(o.name.toLowerCase());
        expect(o.description.length).toBeLessThanOrEqual(100);
        for (const loc of Object.values(o.name_localizations ?? {})) {
          expect(loc as string).toMatch(nameRe);
        }
        if (o.required)
          expect(seenOptional, `${p.name}.${o.name} obrigatoria apos opcional`).toBe(false);
        else seenOptional = true;
        if (o.choices) {
          expect(o.choices.length).toBeLessThanOrEqual(25);
          expect(o.autocomplete).toBeFalsy();
        }
      }
    }
  });

  it("/pantheon [usuario] [ordenar] [genero]; /info com autocomplete", () => {
    const opts = (byName.get("pantheon")!.options as any[]).map((o) => o.name);
    expect(opts).toEqual(["user", "sort", "gender"]);
    expect((byName.get("pantheon")!.options as any[]).every((o) => !o.required)).toBe(true);
    const infoOpt = (byName.get("info")!.options as any[])[0];
    expect(infoOpt).toMatchObject({ name: "name", required: true, autocomplete: true });
    const alias = (byName.get("alias")!.options as any[]).map((o) => o.name);
    expect(alias).toEqual(["name", "text", "slot"]);
  });
});

// ---------------------------------------------------------------------------

describe("$pt / /pantheon", () => {
  const page = (rows: PantheonRow[], total = rows.length) => ({
    rows,
    total,
    totalAether: 12345,
    leaderName: "Zero Two",
  });

  it("$ptw lista so mulheres do proprio jogador, 10 por pagina", async () => {
    svc.listPantheon.mockResolvedValue(
      page([pantheonRow(1, "Zero Two", { variant: "HOLO", awakeningKeys: 3, value: 640 })])
    );
    const m = await run("$ptw");

    expect(svc.listPantheon).toHaveBeenCalledTimes(1);
    const [guildId, userId, query, pageNo, size] = svc.listPantheon.mock.calls[0]!;
    expect([guildId, userId, pageNo, size]).toEqual(["g1", ME, 1, 10]);
    expect(query).toMatchObject({ gender: "FEMALE", sort: "default" });

    const text = embedText(payloadOf(m));
    expect(text).toContain("Panteão de Alice (1 Entidades)");
    expect(text).toContain("**1.** 🌟 **Zero Two** `★3`");
    expect(text).toContain("`Darling in the Franxx`");
    expect(text).toContain("(💠 640)");
    expect(text).toContain("Campeão Líder: **Zero Two**");
    expect(text).toContain(`Valor em Éter: ${formatNumber(12345, "pt-BR")}`);
    expect(payloadOf(m).allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it("varias paginas: botoes do paginador e proxima pagina busca page=2", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => pantheonRow(i + 1, `Hero ${i}`));
    svc.listPantheon.mockResolvedValue(page(rows, 25));
    const m = await run("$pt");
    const payload = payloadOf(m);
    const nav = payload.components[0].toJSON().components;
    expect(nav.map((c: any) => c.custom_id.split(":")[2])).toEqual([
      "first",
      "prev",
      "jump",
      "next",
      "last",
    ]);
    expect(embedText(payload)).toContain("Página 1/3");
  });

  it("jogador mencionado vira o alvo; flags e termos entram na consulta", async () => {
    svc.listPantheon.mockResolvedValue(page([pantheonRow(1, "Nami")]));
    const m = await run(`$ptk= <@${BOB}> $naruto $--bleach`, { mentions: [user(BOB, "Bob")] });
    const [, userId, query] = svc.listPantheon.mock.calls[0]!;
    expect(userId).toBe(BOB);
    expect(query).toMatchObject({ sort: "aether", terms: ["naruto"], excluded: ["bleach"] });
    expect(embedText(payloadOf(m))).toContain("Panteão de Bob");
  });

  it("mencao so por reply (sem token de mencao) nao troca o alvo", async () => {
    svc.listPantheon.mockResolvedValue(page([pantheonRow(1, "Nami")]));
    await run("$pt", { mentions: [user(BOB, "Bob")] });
    expect(svc.listPantheon.mock.calls[0]![1]).toBe(ME);
  });

  it("vazio: mensagem de Panteao vazio; com filtro: mensagem de filtro", async () => {
    svc.listPantheon.mockResolvedValue({ rows: [], total: 0, totalAether: 0, leaderName: null });
    const empty = await run("$pt");
    expect(embedText(payloadOf(empty))).toContain("Seu Panteão ainda está vazio");
    const filtered = await run("$ptw");
    expect(embedText(payloadOf(filtered))).toContain(
      "Nenhuma entidade encontrada com estes filtros."
    );
  });

  it("modo compacto (v) e rank (r-): linha curta com rank", async () => {
    svc.listPantheon.mockResolvedValue(
      page([pantheonRow(1, "Zero Two", { claimRank: 3, seriesTitle: "Serie X" })])
    );
    const m = await run("$ptvr-");
    const text = embedText(payloadOf(m));
    expect(text).toContain("#3");
    expect(text).not.toContain("Serie X");
  });

  it("slash: usuario, ordenar e genero; defer e resposta unica", async () => {
    svc.listPantheon.mockResolvedValue(page([pantheonRow(1, "Nami")]));
    const s = fakeSlash({
      commandName: "pantheon",
      userId: ME,
      options: [
        { name: "user", value: DANA, user: user(DANA, "Dana") } as any,
        { name: "sort", value: "aether" },
        { name: "gender", value: "MALE" },
      ],
    });
    Object.assign((s.interaction as any).user, { username: "Alice", displayName: "Alice" });
    const ctx = slashCtx(s.interaction, pantheonCommand);
    await pantheonCommand.execute(ctx);

    const [, userId, query] = svc.listPantheon.mock.calls[0]!;
    expect(userId).toBe(DANA);
    expect(query).toMatchObject({ sort: "aether", gender: "MALE" });
    expect(s.mock.deferReply).toHaveBeenCalledTimes(1);
    expect(s.mock.editReply).toHaveBeenCalledTimes(1);
    expect(embedText(s.mock.editReply.mock.calls[0]![0])).toContain("Panteão de Dana");
  });

  it("slash sem opcoes: proprio Panteao, ordem padrao", async () => {
    svc.listPantheon.mockResolvedValue(page([pantheonRow(1, "Nami")]));
    const s = fakeSlash({ commandName: "pantheon", userId: ME });
    Object.assign((s.interaction as any).user, { username: "Alice", displayName: "Alice" });
    await pantheonCommand.execute(slashCtx(s.interaction, pantheonCommand));
    const [, userId, query] = svc.listPantheon.mock.calls[0]!;
    expect(userId).toBe(ME);
    expect(query).toMatchObject({ sort: "default" });
    expect(query.gender).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("$im / $info / /info", () => {
  it("sem nome: uso", async () => {
    const err = await runError("$info");
    expect(err.key).toBe("collection.info_usage");
    expect(err.params.prefix).toBe("$");
  });

  it("nao encontrado: mensagem com a consulta escapada", async () => {
    svc.findEntityId.mockResolvedValue(null);
    const err = await runError("$im *bold*");
    expect(err.key).toBe("collection.info_not_found");
    expect(err.params.query).toBe("\\*bold\\*");
  });

  it("carta livre: embed Mudae com arte anexada", async () => {
    svc.findEntityId.mockResolvedValue(7);
    svc.getEntityInfo.mockResolvedValue(entityInfo());
    const m = await run("$im Zero Two");

    expect(svc.findEntityId).toHaveBeenCalledWith("Zero Two");
    expect(svc.getEntityInfo).toHaveBeenCalledWith("g1", 7);
    expect(canvasMock.renderCardInPool).toHaveBeenCalledWith(
      expect.objectContaining({
        skinId: "mudae",
        name: "Zero Two",
        variant: "STANDARD",
        tier: "EPIC",
      })
    );
    const payload = payloadOf(m);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("card.webp");
    const embed = payload.embeds[0].toJSON();
    expect(embed.author.name).toBe("Zero Two");
    expect(embed.image.url).toBe("attachment://card.webp");
    expect(embed.description).toContain("Darling in the Franxx");
    expect(embed.description).toContain("380");
    expect(embed.footer.text).toBe("Livre para Pacto");
  });

  it("edicoes: por nome abre a edicao resolvida e lista as demais; id:<n> abre exatamente a escolhida", async () => {
    svc.findEntityId.mockResolvedValue(7);
    svc.resolveEditionForInfo.mockResolvedValue({
      entityId: 9,
      editions: [
        { id: 7, edition: "BASIC", tier: "COMMON", owned: false },
        { id: 8, edition: "EPIC", tier: "EPIC", owned: false },
        { id: 9, edition: "MYTHIC", tier: "MYTHIC", owned: true },
      ],
    });
    svc.getEntityInfo.mockResolvedValue({ ...entityInfo(), id: 9, tier: "MYTHIC", edition: "MYTHIC" });
    const m = await run("$im Zero Two");
    expect(svc.resolveEditionForInfo).toHaveBeenCalledWith("g1", ME, 7);
    expect(svc.getEntityInfo).toHaveBeenCalledWith("g1", 9);
    const payload = payloadOf(m);
    expect(payload.content).toContain("Edição Básica (id:7)");
    expect(payload.content).toContain("Edição Mítica (id:9 ✅)");
    expect(payload.embeds[0].toJSON().description).toContain("Edição Mítica");

    svc.resolveEditionForInfo.mockClear();
    svc.getEntityInfo.mockClear();
    svc.findEntityId.mockResolvedValue(8);
    svc.getEntityInfo.mockResolvedValue({ ...entityInfo(), id: 8, tier: "EPIC", edition: "EPIC" });
    const m2 = await run("$im id:8");
    expect(svc.resolveEditionForInfo).not.toHaveBeenCalled();
    expect(svc.getEntityInfo).toHaveBeenCalledWith("g1", 8);
    expect(payloadOf(m2).content).toBeUndefined();
  });

  it("edicoes e variacoes: gera botoes interativos col:im_ed e col:im_img para navegacao", async () => {
    svc.findEntityId.mockResolvedValue(7);
    svc.resolveEditionForInfo.mockResolvedValue({
      entityId: 7,
      editions: [
        { id: 7, edition: "BASIC", tier: "COMMON", owned: true },
        { id: 8, edition: "EPIC", tier: "EPIC", owned: false },
        { id: 9, edition: "MYTHIC", tier: "MYTHIC", owned: false },
      ],
    });
    svc.getEntityImages.mockResolvedValue([
      { id: 101, url: "https://example.com/art1.png", isPrimary: true },
      { id: 102, url: "https://example.com/art2.png", isPrimary: false },
    ]);
    svc.getEntityInfo.mockResolvedValue({ ...entityInfo(), id: 7, tier: "COMMON", edition: "BASIC" });

    const m = await run("$im Zero Two");
    const payload = payloadOf(m);
    expect(payload.components).toHaveLength(2); // Row 1 = edições, Row 2 = fotos
    const edButtons = payload.components[0].toJSON().components;
    expect(edButtons.length).toBe(5); // ◀, Básica, Épica, Mítica, ▶
    expect(edButtons[0].custom_id).toContain("col:im_ed");

    const imgButtons = payload.components[1].toJSON().components;
    expect(imgButtons.length).toBe(3); // ◀ Foto, Foto #1/2, Foto ▶
    expect(imgButtons[0].custom_id).toContain("col:im_img");
  });

  it("collectionComponent: processa mudanca de edicao im_ed e edita o reply com deferUpdate", async () => {
    const colHandler = components.find((c) => c.namespace === "col")!;
    expect(colHandler).toBeDefined();

    svc.getEntityInfo.mockResolvedValue({ ...entityInfo(), id: 8, tier: "EPIC", edition: "EPIC" });
    svc.resolveEditionForInfo.mockResolvedValue({
      entityId: 8,
      editions: [
        { id: 7, edition: "BASIC", tier: "COMMON", owned: false },
        { id: 8, edition: "EPIC", tier: "EPIC", owned: true },
      ],
    });
    svc.getEntityImages.mockResolvedValue([]);

    const interaction = {
      isButton: () => true,
      guildId: "g1",
      user: { id: ME },
      deferUpdate: vi.fn(async () => {}),
      editReply: vi.fn(async () => {}),
    } as any;

    await colHandler.handle(interaction, ["im_ed", "8", "0", ME]);
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(svc.getEntityInfo).toHaveBeenCalledWith("g1", 8);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const replyArg = interaction.editReply.mock.calls[0][0];
    expect(replyArg.embeds).toBeDefined();
    expect(replyArg.components).toBeDefined();
  });

  it("carta com dono: usa o valor do pacto, mostra dono e posicao", async () => {
    svc.findEntityId.mockResolvedValue(7);
    svc.getEntityInfo.mockResolvedValue(
      entityInfo({
        pact: {
          id: 55,
          userId: BOB,
          ownerName: "Bob",
          variant: "ASTRAL",
          awakeningKeys: 4,
          aetherAtBind: 5000,
          note: "minha waifu",
          alias: null,
          hasCustomImage: false,
          ownerEmbedColor: "#FF0000",
          position: 3,
        },
      })
    );
    const m = await run("$info Zero Two");
    const embed = payloadOf(m).embeds[0].toJSON();
    expect(embed.description).toContain(formatNumber(5000, "pt-BR")); // max(atual, aether_at_bind)
    expect(embed.description).toContain("minha waifu");
    expect(embed.footer.text).toContain("Pertence a Bob");
    expect(embed.footer.text).toContain("[3]");
    expect(embed.color).toBe(0xff0000);
    expect(canvasMock.renderCardInPool).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "ASTRAL", ownerName: "Bob", awakeningKeys: 4 })
    );
  });

  it("falha ao renderizar: responde so com o embed, sem imagem quebrada", async () => {
    svc.findEntityId.mockResolvedValue(7);
    svc.getEntityInfo.mockResolvedValue(entityInfo());
    canvasMock.renderCardInPool.mockRejectedValue(new Error("canvas fora"));
    const m = await run("$ima Zero Two");
    const payload = payloadOf(m);
    expect(payload.files).toEqual([]);
    expect(payload.embeds[0].toJSON().image).toBeUndefined();
    expect(logMock.warn).toHaveBeenCalled();
  });

  it("slash: usa o valor do autocomplete (id:<n>)", async () => {
    svc.findEntityId.mockResolvedValue(7);
    svc.getEntityInfo.mockResolvedValue(entityInfo());
    const s = fakeSlash({ commandName: "info", options: [{ name: "name", value: "id:7" }] });
    await infoCommand.execute(slashCtx(s.interaction, infoCommand));
    expect(svc.findEntityId).toHaveBeenCalledWith("id:7");
    expect(s.mock.deferReply).toHaveBeenCalled();
    expect(s.mock.editReply).toHaveBeenCalledTimes(1);
  });

  it("autocomplete: ate 25 choices com valor id:<n> e serie no rotulo", async () => {
    const hits = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      name: `Hero ${i}`,
      series: i === 0 ? "Serie Y" : null,
      gender: "FEMALE",
      tier: "COMMON",
    }));
    svc.autocompleteEntities.mockResolvedValue(hits);
    const respond = vi.fn(async () => undefined);
    await infoCommand.autocomplete!({
      options: { getFocused: () => "hero" },
      respond,
    } as any);

    expect(svc.autocompleteEntities).toHaveBeenCalledWith(kvHolder.kv, "hero");
    const choices = (respond.mock.calls[0] as any[])[0] as Array<{ name: string; value: string }>;
    expect(choices[0]).toEqual({ name: "Hero 0 · Serie Y", value: "id:1" });
    expect(choices.length).toBe(30); // o servico ja limita a 25; o comando nao reinventa o corte
  });
});

// ---------------------------------------------------------------------------

describe("$divorce / /dissolve", () => {
  it("sem nome: uso; nome que nao e seu: erro", async () => {
    expect((await runError("$divorce")).key).toBe("collection.dissolve_usage");
    svc.findOwnPact.mockResolvedValue(null);
    const err = await runError("$dissolve Fulana");
    expect(err.key).toBe("errors.not_in_pantheon");
    expect(err.params.query).toBe("Fulana");
    expect(confirmMock.confirm).not.toHaveBeenCalled();
  });

  it("pede confirmacao com o reembolso e dissolve ao confirmar", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.dissolveOwnPact.mockResolvedValue({
      pactId: 55,
      entityId: 7,
      entityName: "Zero Two",
      refund: 1234,
      balance: 9999,
    });
    const m = await run("$divorce zero two");

    expect(svc.findOwnPact).toHaveBeenCalledWith("g1", ME, "zero two");
    const opts = confirmMock.confirm.mock.calls[0]![0];
    expect(opts).toMatchObject({ ownerId: ME, danger: true, locale: "pt-BR" });
    expect(opts.prompt).toContain("Zero Two");
    expect(opts.prompt).toContain(formatNumber(1234, "pt-BR"));
    expect(svc.dissolveOwnPact).toHaveBeenCalledWith(
      "g1",
      ME,
      expect.objectContaining({ pactId: 55 })
    );
    // o prompt foi enviado como resposta e depois veio a confirmacao do resultado
    expect(m.reply).toHaveBeenCalledTimes(2);
    const done = embedText(payloadOf(m, 1));
    expect(done).toContain("Pacto com **Zero Two** foi dissolvido");
    expect(done).toContain(`+${formatNumber(1234, "pt-BR")} Éter`);
    expect(done).toContain(`${formatNumber(9999, "pt-BR")} Éter`);
  });

  it("recusar a confirmacao nao dissolve nada", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    confirmMock.confirm.mockResolvedValue(false);
    const m = await run("$dissolve zero");
    expect(svc.dissolveOwnPact).not.toHaveBeenCalled();
    expect(embedText(payloadOf(m))).toContain("Ação cancelada.");
  });

  it("slash: nome vem do autocomplete (pact:<id>)", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.dissolveOwnPact.mockResolvedValue({
      pactId: 55,
      entityId: 7,
      entityName: "Zero Two",
      refund: 1,
      balance: 2,
    });
    const s = fakeSlash({
      commandName: "dissolve",
      userId: ME,
      options: [{ name: "name", value: "pact:55" }],
    });
    await dissolveCommand.execute(slashCtx(s.interaction, dissolveCommand));
    expect(svc.findOwnPact).toHaveBeenCalledWith("g1", ME, "pact:55");
    expect(svc.dissolveOwnPact).toHaveBeenCalled();
  });

  it("autocomplete dos proprios pactos devolve pact:<id>", async () => {
    svc.searchOwnPacts.mockResolvedValue([{ pactId: 55, name: "Zero Two", series: null }]);
    const respond = vi.fn(async () => undefined);
    await dissolveCommand.autocomplete!({
      guildId: "g1",
      user: { id: ME },
      options: { getFocused: () => "zer" },
      respond,
    } as any);
    expect(svc.searchOwnPacts).toHaveBeenCalledWith("g1", ME, "zer");
    expect(respond).toHaveBeenCalledWith([{ name: "Zero Two", value: "pact:55" }]);
  });
});

// ---------------------------------------------------------------------------

describe("$firstmarry / $fm", () => {
  it("sem nome ou `none`: uso", async () => {
    expect((await runError("$fm")).key).toBe("collection.firstmarry_usage");
    expect((await runError("$firstmarry none")).key).toBe("collection.firstmarry_usage");
  });

  it("define o lider do dono", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setLeader.mockResolvedValue({ pactId: 55, entityId: 7, sortOrder: -1 });
    const m = await run("$fm zero two");
    expect(svc.setLeader).toHaveBeenCalledWith("g1", ME, 55, "zero two");
    expect(embedText(payloadOf(m))).toContain("**Zero Two** agora é o seu **Líder do Panteão**");
  });

  it("nao e dono: erro e nao reordena", async () => {
    svc.findOwnPact.mockResolvedValue(null);
    expect((await runError("$fm alguem")).key).toBe("errors.not_in_pantheon");
    expect(svc.setLeader).not.toHaveBeenCalled();
  });

  it("slash", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setLeader.mockResolvedValue({ pactId: 55, entityId: 7, sortOrder: -1 });
    const s = fakeSlash({
      commandName: "firstmarry",
      userId: ME,
      options: [{ name: "name", value: "pact:55" }],
    });
    await firstmarryCommand.execute(slashCtx(s.interaction, firstmarryCommand));
    expect(svc.setLeader).toHaveBeenCalledWith("g1", ME, 55, "pact:55");
  });
});

// ---------------------------------------------------------------------------

describe("$give / $dar", () => {
  it("valida mencao, auto-doacao, bot e nome", async () => {
    expect((await runError("$give Zero Two")).key).toBe("collection.give_usage_mention");
    const self = await runError(`$give <@${ME}> Zero Two`, { mentions: [user(ME, "Alice")] });
    expect(self.key).toBe("collection.give_self");
    const bot = await runError(`$give <@${BOB}> Zero Two`, { mentions: [user(BOB, "Robo", true)] });
    expect(bot.key).toBe("errors.invalid_user");
    const noName = await runError(`$give <@${BOB}>`, { mentions: [user(BOB, "Bob")] });
    expect(noName.key).toBe("collection.give_usage_name");
    expect(svc.giveEntity).not.toHaveBeenCalled();
  });

  it("nome que nao e seu: erro sem transferir", async () => {
    svc.findOwnPact.mockResolvedValue(null);
    const err = await runError(`$give <@${BOB}> Fulana`, { mentions: [user(BOB, "Bob")] });
    expect(err.key).toBe("errors.not_in_pantheon");
    expect(svc.giveEntity).not.toHaveBeenCalled();
  });

  it("transfere e avisa o destinatario (so ele pode ser mencionado)", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.giveEntity.mockResolvedValue({ pactId: 55, entityId: 7 });
    const m = await run(`$give <@${BOB}> Zero Two`, { mentions: [user(BOB, "Bob")] });

    expect(svc.findOwnPact).toHaveBeenCalledWith("g1", ME, "Zero Two");
    expect(svc.giveEntity).toHaveBeenCalledWith({
      guildId: "g1",
      fromUserId: ME,
      to: { id: BOB, username: "Bob" },
      pactId: 55,
      label: "Zero Two",
    });
    const payload = payloadOf(m);
    expect(payload.content).toContain("**Alice** transferiu o Pacto com **Zero Two**");
    expect(payload.content).toContain(`<@${BOB}>`);
    expect(payload.allowedMentions).toEqual({ users: [BOB], repliedUser: false });
  });

  it("a mencao pode vir depois do nome; id puro so vale se o usuario existir", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.giveEntity.mockResolvedValue({ pactId: 55, entityId: 7 });
    await run(`$dar Zero Two <@${BOB}>`, { mentions: [user(BOB, "Bob")] });
    expect(svc.findOwnPact).toHaveBeenLastCalledWith("g1", ME, "Zero Two");

    // id puro, sem como resolver: recusa
    const err = await runError(`$give ${DANA} Zero Two`);
    expect(err.key).toBe("errors.invalid_user");

    // id puro que o Discord resolve
    const { ctx, cmd, m } = prefixCtx(`$give ${DANA} Zero Two`);
    (m.message as any).client.users = { fetch: vi.fn(async (id: string) => user(id, "Dana")) };
    await cmd.execute(ctx);
    expect(svc.giveEntity).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: { id: DANA, username: "Dana" } })
    );
  });

  it("slash: usuario e nome obrigatorios", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.giveEntity.mockResolvedValue({ pactId: 55, entityId: 7 });
    const s = fakeSlash({
      commandName: "give",
      userId: ME,
      options: [
        { name: "user", value: BOB, user: user(BOB, "Bob") } as any,
        { name: "name", value: "pact:55" },
      ],
    });
    Object.assign((s.interaction as any).user, { username: "Alice", displayName: "Alice" });
    await giveCommand.execute(slashCtx(s.interaction, giveCommand));
    expect(svc.giveEntity).toHaveBeenCalledWith(
      expect.objectContaining({ to: { id: BOB, username: "Bob" }, pactId: 55 })
    );
    expect(s.mock.reply).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe("$note / $alias / $alias2", () => {
  it("splitNameAndText divide no primeiro $ e preserva os demais", () => {
    expect(splitNameAndText(["Zero", "Two", "$", "minha", "$", "nota"])).toEqual({
      name: "Zero Two",
      text: "minha $ nota",
    });
    expect(splitNameAndText(["Zero", "Two"])).toEqual({ name: "Zero Two", text: "" });
    expect(splitNameAndText([])).toEqual({ name: "", text: "" });
    expect(splitNameAndText(["$", "so", "texto"])).toEqual({ name: "", text: "so texto" });
  });

  it("$note grava a nota do dono; sem texto limpa", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setPactText.mockResolvedValue({ pactId: 55, entityId: 7 });
    const m = await run("$note Zero Two $ Minha waifu suprema");
    expect(svc.setPactText).toHaveBeenCalledWith({
      guildId: "g1",
      userId: ME,
      pactId: 55,
      field: "note",
      value: "Minha waifu suprema",
      label: "Zero Two",
    });
    expect(embedText(payloadOf(m))).toContain(
      'Nota para **Zero Two** atualizada: *"Minha waifu suprema"*'
    );

    const cleared = await run("$nota Zero Two");
    expect(svc.setPactText).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: "note", value: "" })
    );
    expect(embedText(payloadOf(cleared))).toContain("Nenhuma nota");
  });

  it("$note sem nome: uso; pacto de outro: erro", async () => {
    expect((await runError("$note")).key).toBe("collection.note_usage");
    svc.findOwnPact.mockResolvedValue(null);
    expect((await runError("$note Fulana $ oi")).key).toBe("errors.not_in_pantheon");
    expect(svc.setPactText).not.toHaveBeenCalled();
  });

  it("texto de usuario e escapado (nada de markdown/menções vindas da nota)", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setPactText.mockResolvedValue({ pactId: 55, entityId: 7 });
    const m = await run("$note Zero Two $ **negrito** @everyone");
    const text = embedText(payloadOf(m));
    expect(text).toContain("\\*\\*negrito\\*\\*");
    expect(payloadOf(m).allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it("$alias grava alias; $alias2 grava alias2; sem apelido: uso", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setPactText.mockResolvedValue({ pactId: 55, entityId: 7 });
    const m = await run("$alias Zero Two $ 002");
    expect(svc.setPactText).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: "alias", value: "002" })
    );
    expect(embedText(payloadOf(m))).toContain("Apelido para **Zero Two** definido como: **002**");

    await run("$alias2 Zero Two $ Darling");
    expect(svc.setPactText).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: "alias2", value: "Darling" })
    );

    expect((await runError("$alias Zero Two")).key).toBe("collection.alias_usage");
    expect((await runError("$alias")).key).toBe("collection.alias_usage");
  });

  it("slash /alias com slot 2 e /note", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setPactText.mockResolvedValue({ pactId: 55, entityId: 7 });
    const a = fakeSlash({
      commandName: "alias",
      userId: ME,
      options: [
        { name: "name", value: "pact:55" },
        { name: "text", value: "zz" },
        { name: "slot", value: 2 },
      ],
    });
    await aliasCommand.execute(slashCtx(a.interaction, aliasCommand));
    expect(svc.setPactText).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: "alias2", value: "zz" })
    );

    const n = fakeSlash({
      commandName: "note",
      userId: ME,
      options: [
        { name: "name", value: "pact:55" },
        { name: "text", value: "oi" },
      ],
    });
    await noteCommand.execute(slashCtx(n.interaction, noteCommand));
    expect(svc.setPactText).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: "note", value: "oi" })
    );
  });

  it("$c / $custompic atualiza a imagem personalizada da carta", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setPactCustomImage.mockResolvedValue({ pactId: 55, entityId: 7 });

    const m = await run("$c Zero Two https://example.com/art.png");
    expect(svc.setPactCustomImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ pactId: 55, imageUrl: "https://example.com/art.png" })
    );
    expect(embedText(payloadOf(m))).toContain("Imagem personalizada de **Zero Two** atualizada");

    const m2 = await run("$c Zero Two remove");
    expect(svc.setPactCustomImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ pactId: 55, imageUrl: null })
    );
    expect(embedText(payloadOf(m2))).toContain("removida");

    expect((await runError("$c Zero Two")).key).toBe("collection.custompic_usage");
    expect((await runError("$c")).key).toBe("collection.custompic_usage");

    safeFetchMock.safeFetchImage.mockRejectedValueOnce(new Error("bad image"));
    expect((await runError("$c Zero Two https://example.com/bad.png")).key).toBe(
      "collection.custompic_invalid_url"
    );
  });

  it("slash /custompic aceita url e reset", async () => {
    svc.findOwnPact.mockResolvedValue(ownPact());
    svc.setPactCustomImage.mockResolvedValue({ pactId: 55, entityId: 7 });

    const slashSet = fakeSlash({
      commandName: "custompic",
      userId: ME,
      options: [
        { name: "name", value: "pact:55" },
        { name: "url", value: "https://example.com/fanart.png" },
      ],
    });
    await custompicCommand.execute(slashCtx(slashSet.interaction, custompicCommand));
    expect(svc.setPactCustomImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ pactId: 55, imageUrl: "https://example.com/fanart.png" })
    );

    const slashReset = fakeSlash({
      commandName: "custompic",
      userId: ME,
      options: [
        { name: "name", value: "pact:55" },
        { name: "reset", value: true },
      ],
    });
    await custompicCommand.execute(slashCtx(slashReset.interaction, custompicCommand));
    expect(svc.setPactCustomImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ pactId: 55, imageUrl: null })
    );
  });
});
