/**
 * Comandos de invocacao: atalhos por prefixo do bot antigo ($w, $wa, $hg, $ar...) e slash `/roll`.
 *
 * Fluxo (`runSummon`): performSummon (consome roll, sorteia, cria a oferta persistente) -> arte
 * (skin padrao `mudae`, WebP anexado como `card.webp`) -> embed + botoes (src/ui/summonEmbed.ts) ->
 * reply -> `setOfferMessage`. Erro de render nunca derruba o roll: a mensagem sai sem arte
 * (com a imagem remota no embed, se houver). Falha ao ENVIAR devolve o roll.
 *
 * Mapa dos atalhos (herdado do summon.ts do bot antigo; `x` = sem filtro de universo):
 *   w  = feminino         wa/wg/wc = feminino + ANIME/GAME/CINEMA      wm/wx = feminino
 *   h  = masculino        ha/hg/hc = masculino + ANIME/GAME/CINEMA     hm/hx = masculino
 *   m  = qualquer genero  ma/mg/mc = ANIME/GAME/CINEMA                 mx    = qualquer
 *   s  = qualquer genero  sa/sg/sc = ANIME/GAME/CINEMA (iguais a m*)
 *   ar = tipo WEAPON
 *
 * MYTHOLOGY: o enum `universe` do schema novo e ANIME | GAME | CINEMA, entao `wm`/`hm` NAO
 * filtram universo (so o genero, como `w`/`h`). Nao viram ANIME de proposito: personagens
 * mitologicos aparecem em series de qualquer universo e forcar ANIME esconderia os de jogos.
 *
 * Mencoes: so quem tem a carta LIVRE na wishlist e mencionado, no maximo MAX_WISHER_MENTIONS,
 * sempre com `allowedMentions` explicito (`parse: []` + `users`). Carta que ja tem dono nao
 * menciona ninguem (ninguem pode firmar pacto nela).
 */
import { AttachmentBuilder, SlashCommandBuilder, type Message } from "discord.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "../../config/constants.js";
import type { AnyCommand, CommandContext, GuildConfig } from "../../core/contracts.js";
import { db } from "../../infra/db/client.js";
import { guilds } from "../../infra/db/schema/index.js";
import { t, tPlural } from "../../i18n/index.js";
import { UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import type { RenderCardInput } from "../../canvas/index.js";
import { errorEmbed } from "../../ui/embeds.js";
import { escapeMarkdown, truncate } from "../../ui/format.js";
import { buildSummonEmbed } from "../../ui/summonEmbed.js";
import { setOfferMessage } from "./offers.js";
import type { EntityType, RollFilter, Universe } from "./pool.js";
import {
  performSummon,
  refundRoll,
  type SummonGuildConfig,
  type SummonParams,
  type SummonResult,
} from "./service.js";
import {
  buildOfferView,
  describeUserError,
  findWishers,
  loadPactExtras,
  MAX_WISHER_MENTIONS,
  summonOfferRow,
  tr,
  type PactExtras,
} from "./views.js";

const log = childLogger("summon:commands");

/** Tempo maximo esperando a arte; passou disso a mensagem sai sem ela. */
export const RENDER_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Atalhos e filtros
// ---------------------------------------------------------------------------

/** Tabela atalho -> filtro. Fonte unica; os comandos abaixo registram exatamente estas chaves. */
export const SUMMON_SHORTCUTS: Readonly<Record<string, RollFilter>> = {
  w: { gender: "FEMALE" },
  wa: { gender: "FEMALE", universe: "ANIME" },
  wg: { gender: "FEMALE", universe: "GAME" },
  wc: { gender: "FEMALE", universe: "CINEMA" },
  wm: { gender: "FEMALE" }, // MYTHOLOGY nao existe no schema novo: ver cabecalho
  wx: { gender: "FEMALE" },
  h: { gender: "MALE" },
  ha: { gender: "MALE", universe: "ANIME" },
  hg: { gender: "MALE", universe: "GAME" },
  hc: { gender: "MALE", universe: "CINEMA" },
  hm: { gender: "MALE" }, // idem wm
  hx: { gender: "MALE" },
  m: {},
  mx: {},
  ma: { universe: "ANIME" },
  mg: { universe: "GAME" },
  mc: { universe: "CINEMA" },
  s: {},
  sa: { universe: "ANIME" },
  sg: { universe: "GAME" },
  sc: { universe: "CINEMA" },
  ar: { type: "WEAPON" },
};

const ENTITY_TYPES = ["CHARACTER", "WEAPON", "COMPANION", "DOMAIN"] as const satisfies readonly EntityType[];
const GENDER_FILTERS = ["FEMALE", "MALE", "BOTH"] as const;
const UNIVERSES = ["ANIME", "GAME", "CINEMA"] as const satisfies readonly Universe[];

/** Argumentos de `/roll` (e de `$roll <palavras>`). Atalhos nao usam argumentos. */
export const rollArgsSchema = z.object({
  type: z.enum(ENTITY_TYPES).optional(),
  gender: z.enum(GENDER_FILTERS).optional(),
  universe: z.enum(UNIVERSES).optional(),
});
export type RollArgs = z.infer<typeof rollArgsSchema>;

/** Filtro final: o do atalho digitado, sobrescrito pelos argumentos explicitos. */
export function resolveRollFilter(invokedAs: string, args: RollArgs = {}): RollFilter {
  const key = invokedAs.trim().toLowerCase();
  const filter: RollFilter = Object.hasOwn(SUMMON_SHORTCUTS, key) ? { ...SUMMON_SHORTCUTS[key] } : {};
  if (args.gender) filter.gender = args.gender;
  if (args.universe) filter.universe = args.universe;
  if (args.type) filter.type = args.type;
  return filter;
}

const TOKEN_WORDS: Readonly<Record<string, RollArgs>> = {
  anime: { universe: "ANIME" },
  manga: { universe: "ANIME" },
  game: { universe: "GAME" },
  games: { universe: "GAME" },
  jogo: { universe: "GAME" },
  jogos: { universe: "GAME" },
  cinema: { universe: "CINEMA" },
  filme: { universe: "CINEMA" },
  filmes: { universe: "CINEMA" },
  movie: { universe: "CINEMA" },
  movies: { universe: "CINEMA" },
  female: { gender: "FEMALE" },
  waifu: { gender: "FEMALE" },
  feminino: { gender: "FEMALE" },
  male: { gender: "MALE" },
  husbando: { gender: "MALE" },
  masculino: { gender: "MALE" },
  both: { gender: "BOTH" },
  any: { gender: "BOTH" },
  ambos: { gender: "BOTH" },
  character: { type: "CHARACTER" },
  personagem: { type: "CHARACTER" },
  weapon: { type: "WEAPON" },
  arma: { type: "WEAPON" },
  companion: { type: "COMPANION" },
  companheiro: { type: "COMPANION" },
  domain: { type: "DOMAIN" },
  dominio: { type: "DOMAIN" },
};

const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** `$roll anime female` -> { universe, gender }. Palavras desconhecidas sao ignoradas. */
export function parseRollTokens(tokens: readonly string[]): RollArgs {
  const out: RollArgs = {};
  for (const raw of tokens) {
    const key = stripAccents(raw.toLowerCase());
    if (Object.hasOwn(TOKEN_WORDS, key)) Object.assign(out, TOKEN_WORDS[key]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dependencias injetaveis (testes)
// ---------------------------------------------------------------------------

export interface SummonDeps {
  /** Config completa do servidor para o dominio (inclui campos que o `GuildConfig` do core nao traz). */
  loadGuildConfig(base: GuildConfig): Promise<SummonGuildConfig>;
  performSummon(params: SummonParams): Promise<SummonResult>;
  refundRoll(
    guildId: string,
    userId: string,
    consumed: SummonResult["consumption"]
  ): Promise<void>;
  /** Wishers da carta livre, sem quem rolou. */
  findWishers(guildId: string, entityId: number, exceptUserId: string): Promise<string[]>;
  loadPactExtras(pact: { id: number; guildId: string; userId: string }): Promise<PactExtras | null>;
  /**
   * Skin cosmetica do dono da carta. Ainda nao ha coluna de skin no schema, entao o padrao e
   * `undefined` (skin `mudae`); ligue aqui quando existir.
   */
  preferredSkin(guildId: string, userId: string): Promise<string | undefined>;
  /** WebP da arte. O padrao importa o canvas sob demanda (scripts de deploy nao carregam o addon nativo). */
  render(input: RenderCardInput): Promise<Buffer>;
  setOfferMessage(offerId: number, messageId: string): Promise<void>;
  renderTimeoutMs?: number;
}

/** Linha de `guilds` -> config do dominio; se a linha sumir, deriva do `GuildConfig` em cache. */
export async function loadSummonGuildConfig(base: GuildConfig): Promise<SummonGuildConfig> {
  const [row] = await db
    .select({
      id: guilds.id,
      prefix: guilds.prefix,
      baseRolls: guilds.baseRolls,
      rollIntervalMin: guilds.rollIntervalMin,
      resetOffsetMin: guilds.resetOffsetMin,
      claimCooldownMinutes: guilds.claimCooldownMinutes,
      pactsPerWindow: guilds.pactsPerWindow,
      claimWindowSeconds: guilds.claimWindowSeconds,
      snipeProtectionLevel: guilds.snipeProtectionLevel,
      snipeProtectionSeconds: guilds.snipeProtectionSeconds,
      aetherSnipeProtectionLevel: guilds.aetherSnipeProtectionLevel,
      aetherSnipeProtectionSeconds: guilds.aetherSnipeProtectionSeconds,
      releaseBoostEnabled: guilds.releaseBoostEnabled,
      allowAdult: guilds.allowAdult,
    })
    .from(guilds)
    .where(eq(guilds.id, base.id))
    .limit(1);
  if (row) return row;
  return {
    id: base.id,
    prefix: base.prefix,
    baseRolls: base.baseRolls,
    rollIntervalMin: base.rollIntervalMin,
    resetOffsetMin: base.resetOffsetMin,
    claimCooldownMinutes: base.claimIntervalMin,
    pactsPerWindow: 1,
    claimWindowSeconds: base.claimWindowSeconds,
    snipeProtectionLevel: base.snipeProtectionLevel,
    snipeProtectionSeconds: base.snipeProtectionSeconds,
    aetherSnipeProtectionLevel: base.snipeProtectionLevel,
    aetherSnipeProtectionSeconds: base.snipeProtectionSeconds,
    releaseBoostEnabled: base.releaseBoostEnabled,
    allowAdult: base.allowAdult,
  };
}

export const defaultSummonDeps: SummonDeps = {
  loadGuildConfig: loadSummonGuildConfig,
  performSummon,
  refundRoll,
  findWishers,
  loadPactExtras,
  preferredSkin: async () => undefined,
  render: async (input) => {
    const { renderCardInPool } = await import("../../canvas/index.js");
    return renderCardInPool(input);
  },
  setOfferMessage,
};

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

/** Executa `fn` e devolve `fallback` (logando) se falhar: dados opcionais nunca quebram o roll. */
async function optional<T>(fn: () => Promise<T>, fallback: T, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ err }, `falha ao ${what}; seguindo sem isso`);
    return fallback;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout de ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Avatar do dono pelo cache do Discord (sem rede); undefined se nao estiver em cache. */
function cachedAvatar(ctx: CommandContext<RollArgs>, userId: string): string | undefined {
  try {
    const member = ctx.guild.members?.cache?.get(userId);
    if (member) return member.displayAvatarURL({ size: 64 });
    return ctx.guild.client?.users?.cache?.get(userId)?.displayAvatarURL({ size: 64 });
  } catch {
    return undefined;
  }
}

async function replyRollsExhausted(ctx: CommandContext<RollArgs>, err: UserError): Promise<void> {
  await ctx.reply({
    embeds: [
      errorEmbed({
        description: describeUserError(err, ctx.locale),
        locale: ctx.locale,
        footer: false,
      }),
    ],
    ephemeral: true,
  });
}

function offerContent(
  result: SummonResult,
  wishers: readonly string[],
  locale: Locale
): string | undefined {
  const parts: string[] = [];

  if (wishers.length > 0) {
    parts.push(
      tr("summon.wish_alert", locale, {
        users: wishers.map((id) => `<@${id}>`).join(" "),
        entity: escapeMarkdown(truncate(result.entity.name, 100)),
      })
    );
  }

  if (result.awardedKey) {
    parts.push(tr("summon.key_bonus", locale, { keys: result.awakeningKeys }));
  }

  const remaining = result.consumption.remaining + result.consumption.stacked;
  if (remaining > 0 && remaining <= 2) {
    parts.push(tPlural("summon.rolls_left", remaining, locale, { count: remaining }));
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}

/** Nucleo dos comandos de invocacao. `deps` existe para testes. */
export async function runSummon(
  ctx: CommandContext<RollArgs>,
  deps: SummonDeps = defaultSummonDeps
): Promise<void> {
  const locale = ctx.locale;
  const channelId = ctx.message?.channelId ?? ctx.interaction?.channelId;
  if (!channelId) throw new Error("invocacao sem canal");

  const filter = resolveRollFilter(ctx.invokedAs, ctx.args);
  const guild = await deps.loadGuildConfig(ctx.guildConfig);

  let result: SummonResult;
  try {
    result = await deps.performSummon({
      guild,
      userId: ctx.user.id,
      username: ctx.user.username,
      channelId,
      filter,
    });
  } catch (err) {
    // Rolls esgotados: resposta propria com o horario exato do reset (efemera no slash).
    if (err instanceof UserError && err.key === "summon.rolls_exhausted") {
      await replyRollsExhausted(ctx, err);
      return;
    }
    throw err;
  }

  const { entity, offer } = result;
  const pact = entity.pact;
  let sent: Message;
  try {
    // Slash: confirma ja (prazo de 3 s); prefixo: "digitando". A arte pode demorar.
    await ctx.defer();

    const [wishers, extras, skinId] = await Promise.all([
      pact
        ? Promise.resolve<string[]>([])
        : optional(() => deps.findWishers(guild.id, entity.id, ctx.user.id), [], "buscar wishers"),
      pact
        ? optional(
            () => deps.loadPactExtras({ id: pact.id, guildId: guild.id, userId: pact.userId }),
            null,
            "carregar dados do pacto"
          )
        : Promise.resolve(null),
      optional(
        () => deps.preferredSkin(guild.id, pact?.userId ?? ctx.user.id),
        undefined,
        "buscar skin do dono"
      ),
    ]);

    const view = buildOfferView(result, locale, {
      avatarUrl: pact ? cachedAvatar(ctx, pact.userId) : undefined,
      embedColor: extras?.embedColor,
      note: extras?.note,
      customImage: extras?.customImage,
      position: extras?.position,
    });
    const imageUrl = extras?.customImage ?? entity.imageUrl ?? undefined;

    const art = await optional<Buffer | null>(
      () =>
        withTimeout(
          deps.render({
            entityId: String(entity.id),
            name: entity.name,
            franchise: view.franchise,
            universe: entity.universe,
            tier: entity.tier,
            variant: result.variant,
            awakeningKeys: result.awakeningKeys,
            aetherValue: result.aetherValue,
            popularityRank: entity.popularityRank ?? undefined,
            atk: entity.baseAtk,
            def: entity.baseDef,
            spd: entity.baseSpd,
            ownerName: view.ownerName,
            locale,
            imageUrl,
            preferredSkinId: skinId,
          }),
          deps.renderTimeoutMs ?? RENDER_TIMEOUT_MS
        ),
      null,
      "renderizar a carta"
    );

    const { embed, attachmentName } = buildSummonEmbed(view, { locale });
    // Sem arte renderizada: usa a imagem remota (se houver) para a mensagem nao ficar nua.
    if (!art) embed.setImage(imageUrl ?? null);

    sent = await ctx.reply({
      content: offerContent(result, wishers, locale),
      embeds: [embed],
      files: art ? [new AttachmentBuilder(art, { name: attachmentName })] : [],
      components: [summonOfferRow(offer.id, offer.orbAether != null)],
      allowedMentions: { parse: [], users: wishers.slice(0, MAX_WISHER_MENTIONS) },
    });
  } catch (err) {
    // Nao conseguimos mostrar a carta: devolve o roll (a oferta orfa expira sozinha).
    await deps
      .refundRoll(guild.id, ctx.user.id, result.consumption)
      .catch((e: unknown) => log.warn({ err: e }, "falha ao devolver o roll"));
    throw err;
  }

  await deps
    .setOfferMessage(offer.id, sent.id)
    .catch((err: unknown) => log.warn({ err, offerId: offer.id }, "falha ao vincular a mensagem da oferta"));
}

// ---------------------------------------------------------------------------
// Definicao dos comandos
// ---------------------------------------------------------------------------

function buildRollSlash() {
  const optionName = (en: string, pt: string) => ({ en, pt });
  const type = optionName("type", "tipo");
  const gender = optionName("gender", "genero");
  const universe = optionName("universe", "universo");

  return new SlashCommandBuilder()
    .setName("roll")
    .setDescription(t("help.commands.summon", "pt-BR"))
    .setDescriptionLocalizations({ "en-US": t("help.commands.summon", "en-US") })
    .addStringOption((o) =>
      o
        .setName(type.en)
        .setNameLocalizations({ "pt-BR": type.pt })
        .setDescription(tr("summon.roll_opt_type", "pt-BR"))
        .setDescriptionLocalizations({ "en-US": tr("summon.roll_opt_type", "en-US") })
        .addChoices(
          ...ENTITY_TYPES.map((value) => ({
            name: tr(`catalog.type.${value}`, "pt-BR"),
            name_localizations: { "en-US": tr(`catalog.type.${value}`, "en-US") },
            value,
          }))
        )
    )
    .addStringOption((o) =>
      o
        .setName(gender.en)
        .setNameLocalizations({ "pt-BR": gender.pt })
        .setDescription(tr("summon.roll_opt_gender", "pt-BR"))
        .setDescriptionLocalizations({ "en-US": tr("summon.roll_opt_gender", "en-US") })
        .addChoices(
          ...GENDER_FILTERS.map((value) => ({
            name: t(`catalog.gender.${value}`, "pt-BR"),
            name_localizations: { "en-US": t(`catalog.gender.${value}`, "en-US") },
            value,
          }))
        )
    )
    .addStringOption((o) =>
      o
        .setName(universe.en)
        .setNameLocalizations({ "pt-BR": universe.pt })
        .setDescription(tr("summon.roll_opt_universe", "pt-BR"))
        .setDescriptionLocalizations({ "en-US": tr("summon.roll_opt_universe", "en-US") })
        .addChoices(
          ...UNIVERSES.map((value) => ({
            name: t(`catalog.universe.${value}`, "pt-BR"),
            name_localizations: { "en-US": t(`catalog.universe.${value}`, "en-US") },
            value,
          }))
        )
    );
}

const common = {
  category: "summon",
  args: rollArgsSchema,
  // Atalhos ignoram tokens extras; so `$roll` interpreta palavras (anime, female, weapon...).
  parseArgs: (tokens: string[], meta: { invokedAs: string }) =>
    meta.invokedAs === "roll" ? parseRollTokens(tokens) : {},
  execute: (ctx: CommandContext<RollArgs>) => runSummon(ctx),
} as const;

/** `/roll [tipo] [genero] [universo]`, `$roll <palavras>` e os atalhos genericos `$s*`. */
export const rollCommand: AnyCommand = {
  ...common,
  name: "roll",
  aliases: ["s", "sa", "sg", "sc"],
  descriptionKey: "help.commands.summon",
  slash: buildRollSlash,
};

export const waifuCommand: AnyCommand = {
  ...common,
  name: "w",
  aliases: ["wa", "wg", "wc", "wm", "wx"],
  descriptionKey: "help.commands.summon_waifu",
};

export const husbandoCommand: AnyCommand = {
  ...common,
  name: "h",
  aliases: ["ha", "hg", "hc", "hm", "hx"],
  descriptionKey: "help.commands.summon_husbando",
};

export const mixedCommand: AnyCommand = {
  ...common,
  name: "m",
  aliases: ["mx", "ma", "mg", "mc"],
  descriptionKey: "help.commands.summon_mixed",
};

export const weaponCommand: AnyCommand = {
  ...common,
  name: "ar",
  descriptionKey: "help.commands.summon_weapon",
};

export const summonCommands: AnyCommand[] = [
  rollCommand,
  waifuCommand,
  husbandoCommand,
  mixedCommand,
  weaponCommand,
];
