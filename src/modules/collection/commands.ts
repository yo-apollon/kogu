/**
 * Comandos do Panteao: $pt/$pantheon, $im/$info, $divorce/$dissolve, $firstmarry/$fm, $give,
 * $note, $alias/$alias2 (e os slash equivalentes). Textos vem de locales/*.json (`collection.*`,
 * `errors.*`, `ui.*`); so os rotulos das opcoes de slash ficam locais (ver SLASH_TEXT).
 */
import {
  AttachmentBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
  type APIApplicationCommandOptionChoice,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type User,
} from "discord.js";
import { z } from "zod";
import { renderCardInPool } from "../../canvas/index.js";
import type { AnyCommand, CommandContext, CommandDefinition } from "../../core/contracts.js";
import type { CommandRegistration } from "../../core/registry.js";
import { t } from "../../i18n/index.js";
import { safeFetchImage } from "../../lib/http/safeFetch.js";
import { getKV } from "../../infra/redis/client.js";
import { UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import { confirm } from "../../ui/components/confirm.js";
import { createPaginator } from "../../ui/components/paginator.js";
import { infoEmbed, successEmbed } from "../../ui/embeds.js";
import { formatNumber } from "../../ui/format.js";
import { buildSummonEmbed } from "../../ui/summonEmbed.js";
import {
  MAX_TERMS,
  PANTHEON_GENDERS,
  PANTHEON_SHORTCUT,
  PANTHEON_SORTS,
  hasActiveFilters,
  parsePantheonTokens,
  queryFromSlash,
  userIdFromToken,
} from "./flags.js";
import {
  PAGE_SIZE,
  autocompleteEntities,
  dissolveOwnPact,
  findEntityId,
  findOwnPact,
  getEntityInfo,
  giveEntity,
  listPantheon,
  searchOwnPacts,
  setLeader,
  setPactCustomImage,
  setPactText,
  type OwnPact,
  type PantheonPage,
  type PantheonRow,
} from "./service.js";
import {
  buildInfoView,
  buildPantheonEmbed,
  cardRenderInput,
  entityChoice,
  pactChoice,
  safeText,
} from "./views.js";
import {
  buildPickUserComponents,
  buildTradeComponents,
  buildTradeEmbed,
  createTradeSession,
} from "./tradeViews.js";

const log = childLogger("collection");

// ---------------------------------------------------------------------------
// Slash: textos locais (TODO i18n: propor as chaves em collection.slash.* quando o F6 abrir os locales)
// ---------------------------------------------------------------------------

interface OptionText {
  name: string;
  ptName: string;
  pt: string;
  en: string;
}

const SLASH_TEXT = {
  user: {
    name: "user",
    ptName: "usuario",
    pt: "Jogador cujo Panteão será exibido.",
    en: "Player whose Pantheon to show.",
  },
  sort: { name: "sort", ptName: "ordenar", pt: "Critério de ordenação.", en: "Sort order." },
  gender: { name: "gender", ptName: "genero", pt: "Filtrar por gênero.", en: "Filter by gender." },
  target: {
    name: "user",
    ptName: "usuario",
    pt: "Jogador que receberá a entidade.",
    en: "Player who receives the entity.",
  },
  name: {
    name: "name",
    ptName: "nome",
    pt: "Nome da entidade (ou apelido).",
    en: "Entity name (or nickname).",
  },
  note: { name: "text", ptName: "texto", pt: "Texto da nota.", en: "Note text." },
  alias: { name: "text", ptName: "texto", pt: "Apelido da entidade.", en: "Entity nickname." },
  slot: {
    name: "slot",
    ptName: "slot",
    pt: "Qual apelido definir (1 ou 2).",
    en: "Which nickname to set (1 or 2).",
  },
  custompicUrl: {
    name: "url",
    ptName: "url",
    pt: "Link direto da imagem (HTTPS).",
    en: "Direct image URL (HTTPS).",
  },
  custompicReset: {
    name: "reset",
    ptName: "remover",
    pt: "Remover imagem personalizada e voltar à original.",
    en: "Remove custom art and reset to default.",
  },
  tradeTarget: {
    name: "user",
    ptName: "usuario",
    pt: "Jogador com quem deseja negociar.",
    en: "Player to trade with.",
  },
  tradeMyCard: {
    name: "my_card",
    ptName: "minha_carta",
    pt: "Sua carta ofertada (opcional).",
    en: "Your offered card (optional).",
  },
  tradeTheirCard: {
    name: "their_card",
    ptName: "carta_dele",
    pt: "Carta solicitada do outro jogador (opcional).",
    en: "Card requested from the other player (optional).",
  },
} satisfies Record<string, OptionText>;

const SORT_CHOICES: ReadonlyArray<{ value: string; pt: string; en: string }> = [
  { value: "aether", pt: "Éter", en: "Aether" },
  { value: "keys", pt: "Selos de Despertar", en: "Awakening keys" },
  { value: "soulmates", pt: "Almas gêmeas", en: "Soulmates" },
  { value: "name", pt: "Nome", en: "Name" },
  { value: "series", pt: "Série", en: "Series" },
  { value: "claim_rank", pt: "Rank de pacto", en: "Pact rank" },
  { value: "like_rank", pt: "Rank de likes", en: "Like rank" },
];

function genderChoices(): APIApplicationCommandOptionChoice<string>[] {
  const labels: Record<string, { pt: string; en: string }> = {
    FEMALE: { pt: t("catalog.gender.FEMALE", "pt-BR"), en: t("catalog.gender.FEMALE", "en-US") },
    MALE: { pt: t("catalog.gender.MALE", "pt-BR"), en: t("catalog.gender.MALE", "en-US") },
    NONBINARY: { pt: "Não-binário", en: "Non-binary" },
  };
  return ["FEMALE", "MALE", "NONBINARY"].map((value) => ({
    name: labels[value].pt,
    name_localizations: { "en-US": labels[value].en },
    value,
  }));
}

interface Describable {
  setName(name: string): this;
  setNameLocalizations(localizations: Record<string, string> | null): this;
  setDescription(description: string): this;
  setDescriptionLocalizations(localizations: Record<string, string> | null): this;
}

function describe<T extends Describable>(option: T, text: OptionText): T {
  return option
    .setName(text.name)
    .setNameLocalizations({ "pt-BR": text.ptName })
    .setDescription(text.pt)
    .setDescriptionLocalizations({ "en-US": text.en });
}

function slashBase(name: string, descriptionKey: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(t(descriptionKey, "pt-BR"))
    .setDescriptionLocalizations({ "en-US": t(descriptionKey, "en-US") });
}

// ---------------------------------------------------------------------------
// Helpers de argumentos e contexto
// ---------------------------------------------------------------------------

const userRefSchema = z.object({
  id: z.string().regex(/^\d{15,25}$/),
  name: z.string().max(80),
  bot: z.boolean().default(false),
});
type UserRef = z.infer<typeof userRefSchema>;

const queryText = z.string().trim().max(100).default("");

function refFromUser(
  user: Pick<User, "id" | "username" | "bot"> & { displayName?: string }
): UserRef {
  return { id: user.id, name: user.displayName ?? user.username, bot: user.bot === true };
}

/** Mencao `<@id>` entre os tokens (so vale a que esta no texto, nao a de uma resposta/reply). */
function mentionedUser(message: Message, tokens: readonly string[]): UserRef | undefined {
  for (const token of tokens) {
    const id = userIdFromToken(token);
    if (!id) continue;
    const user = message.mentions?.users?.get(id);
    return user ? refFromUser(user) : { id, name: id, bot: false };
  }
  return undefined;
}

function optionValue(interaction: ChatInputCommandInteraction, name: string): unknown {
  return interaction.options.data.find((o) => o.name === name)?.value;
}

function optionUser(interaction: ChatInputCommandInteraction, name: string): UserRef | undefined {
  const option = interaction.options.data.find((o) => o.name === name);
  if (!option) return undefined;
  if (option.user) return refFromUser(option.user);
  return typeof option.value === "string"
    ? { id: option.value, name: option.value, bot: false }
    : undefined;
}

/** Prefixo mostrado nas mensagens de uso: `/` no slash, prefixo do servidor no resto. */
function usagePrefix(ctx: CommandContext<any>): string {
  return ctx.source === "slash" ? "/" : ctx.guildConfig.prefix;
}

/** Nome de exibicao de um usuario citado por id (busca no Discord so se o nome nao veio). */
async function resolveUser(ctx: CommandContext<any>, ref: UserRef): Promise<UserRef | null> {
  if (ref.name !== ref.id) return ref;
  const client = ctx.message?.client ?? ctx.interaction?.client;
  try {
    const user = await client?.users.fetch(ref.id);
    return user ? refFromUser(user) : null;
  } catch {
    return null;
  }
}

async function requireOwnPact(ctx: CommandContext<any>, query: string): Promise<OwnPact> {
  const pact = await findOwnPact(ctx.guild.id, ctx.user.id, query);
  if (!pact) throw new UserError("errors.not_in_pantheon", { query: safeText(query) });
  return pact;
}

/** Autocomplete dos pactos do proprio jogador (usado por dissolve/firstmarry/give/note/alias). */
async function ownPactAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const rows = await searchOwnPacts(
    interaction.guildId,
    interaction.user.id,
    String(interaction.options.getFocused())
  );
  await interaction.respond(rows.map(pactChoice));
}

// ---------------------------------------------------------------------------
// $pt / $pantheon / /pantheon
// ---------------------------------------------------------------------------

const pantheonQuerySchema = z.object({
  gender: z.enum(PANTHEON_GENDERS).optional(),
  universe: z.enum(["ANIME", "GAME", "CINEMA"]).optional(),
  keys: z.enum(["any", "none", "soulmates"]).optional(),
  sort: z.enum(PANTHEON_SORTS),
  terms: z.array(z.string()).max(MAX_TERMS),
  excluded: z.array(z.string()).max(MAX_TERMS),
  display: z.object({
    baseAether: z.boolean(),
    claimRank: z.boolean(),
    likeRank: z.boolean(),
    compact: z.boolean(),
  }),
});

const pantheonArgs = z.object({
  target: userRefSchema.optional(),
  query: pantheonQuerySchema,
});

export const pantheonCommand: CommandDefinition<typeof pantheonArgs> = {
  name: "pantheon",
  aliases: ["pt", "p", "mm", "mymarry"],
  category: "collection",
  descriptionKey: "help.commands.pantheon",
  args: pantheonArgs,
  cooldownMs: 2_000,
  parseArgs(tokens, { invokedAs, message }) {
    const parsed = parsePantheonTokens(invokedAs, tokens);
    return { target: mentionedUser(message, tokens), query: parsed.query };
  },
  slash: () => {
    const builder = slashBase("pantheon", "help.commands.pantheon");
    builder.addUserOption((o) => describe(o, SLASH_TEXT.user));
    builder.addStringOption((o) =>
      describe(o, SLASH_TEXT.sort).addChoices(
        ...SORT_CHOICES.map((c) => ({
          name: c.pt,
          name_localizations: { "en-US": c.en },
          value: c.value,
        }))
      )
    );
    builder.addStringOption((o) => describe(o, SLASH_TEXT.gender).addChoices(...genderChoices()));
    return builder;
  },
  slashArgs: (interaction) => ({
    target: optionUser(interaction, "user"),
    query: queryFromSlash({
      sort: optionValue(interaction, "sort"),
      gender: optionValue(interaction, "gender"),
    }),
  }),
  async execute(ctx) {
    await ctx.defer();
    const requested = ctx.args.target ? await resolveUser(ctx, ctx.args.target) : null;
    const target = requested ?? refFromUser(ctx.user);
    const { query } = ctx.args;
    const filtered = hasActiveFilters(query);
    const guildId = ctx.guild.id;
    const kv = await getKV();

    let summary: Pick<PantheonPage, "total" | "totalAether" | "leaderName"> = {
      total: 0,
      totalAether: 0,
      leaderName: null,
    };
    const paginator = await createPaginator<PantheonRow>({
      kv,
      ownerId: ctx.user.id,
      pageSize: PAGE_SIZE,
      locale: ctx.locale,
      loader: async (page, size) => {
        const result = await listPantheon(guildId, target.id, query, page, size);
        summary = result;
        return { items: result.rows, total: result.total };
      },
      renderPage: (items, page, totalPages) => ({
        embeds: [
          buildPantheonEmbed({
            userName: target.name,
            rows: items,
            page,
            totalPages,
            pageSize: PAGE_SIZE,
            query,
            summary,
            filtered,
            locale: ctx.locale,
          }),
        ],
      }),
    });

    const message = await ctx.reply(paginator.payload);
    paginator.attach(message);
  },
};

// ---------------------------------------------------------------------------
// $im / $info / /info
// ---------------------------------------------------------------------------

const infoArgs = z.object({ query: queryText });

export const infoCommand: CommandDefinition<typeof infoArgs> = {
  name: "info",
  aliases: ["im", "infomarry", "ima"],
  category: "collection",
  descriptionKey: "help.commands.info",
  args: infoArgs,
  cooldownMs: 3_000,
  parseArgs: (tokens) => ({ query: tokens.join(" ") }),
  slash: () =>
    slashBase("info", "help.commands.info").addStringOption((o) =>
      describe(o, SLASH_TEXT.name).setRequired(true).setAutocomplete(true)
    ),
  slashArgs: (interaction) => ({ query: optionValue(interaction, "name") }),
  async autocomplete(interaction) {
    const kv = await getKV();
    const hits = await autocompleteEntities(kv, String(interaction.options.getFocused()));
    await interaction.respond(hits.map(entityChoice));
  },
  async execute(ctx) {
    const { query } = ctx.args;
    if (!query) throw new UserError("collection.info_usage", { prefix: usagePrefix(ctx) });
    await ctx.defer();

    const notFound = () =>
      new UserError("collection.info_not_found", {
        query: safeText(query),
        prefix: usagePrefix(ctx),
      });
    const entityId = await findEntityId(query);
    if (entityId === null) throw notFound();
    const info = await getEntityInfo(ctx.guild.id, entityId);
    if (!info) throw notFound();

    const ownerAvatarUrl = info.pact
      ? ctx.guild.members?.cache?.get(info.pact.userId)?.displayAvatarURL()
      : undefined;
    const view = buildInfoView(info, { locale: ctx.locale, ownerAvatarUrl });
    const { embed, attachmentName } = buildSummonEmbed(view, {
      locale: ctx.locale,
      pactLimit: ctx.guildConfig.pactLimit,
    });

    const files: AttachmentBuilder[] = [];
    try {
      const art = await renderCardInPool(cardRenderInput(info, ctx.locale));
      files.push(new AttachmentBuilder(art, { name: attachmentName }));
    } catch (err) {
      // Sem arte o embed continua util; nao mostrar uma imagem quebrada.
      log.warn({ err, entityId }, "falha ao renderizar a carta do $info");
      embed.setImage(null);
    }
    await ctx.reply({ embeds: [embed], files });
  },
};

// ---------------------------------------------------------------------------
// $divorce / $dissolve / /dissolve
// ---------------------------------------------------------------------------

const dissolveArgs = z.object({ query: queryText });

export const dissolveCommand: CommandDefinition<typeof dissolveArgs> = {
  name: "dissolve",
  aliases: ["divorce", "divorcio"],
  category: "collection",
  descriptionKey: "help.commands.dissolve",
  args: dissolveArgs,
  cooldownMs: 3_000,
  parseArgs: (tokens) => ({ query: tokens.join(" ") }),
  slash: () =>
    slashBase("dissolve", "help.commands.dissolve").addStringOption((o) =>
      describe(o, SLASH_TEXT.name).setRequired(true).setAutocomplete(true)
    ),
  slashArgs: (interaction) => ({ query: optionValue(interaction, "name") }),
  autocomplete: ownPactAutocomplete,
  async execute(ctx) {
    const { query } = ctx.args;
    if (!query) throw new UserError("collection.dissolve_usage", { prefix: usagePrefix(ctx) });

    const pact = await requireOwnPact(ctx, query);
    const entity = safeText(pact.name);
    const accepted = await confirm({
      ownerId: ctx.user.id,
      locale: ctx.locale,
      danger: true,
      prompt: ctx.t("collection.dissolve_confirm", {
        entity,
        refund: formatNumber(pact.value, ctx.locale),
      }),
      send: (payload) => ctx.reply(payload),
    });
    if (!accepted) {
      await ctx.reply({
        embeds: [infoEmbed({ description: ctx.t("ui.confirm.cancelled"), footer: false })],
      });
      return;
    }

    const result = await dissolveOwnPact(ctx.guild.id, ctx.user.id, pact);
    await ctx.reply({
      embeds: [
        successEmbed({
          description: ctx.t("collection.dissolve_success", {
            entity,
            refund: formatNumber(result.refund, ctx.locale),
            balance: formatNumber(result.balance, ctx.locale),
          }),
          footer: false,
        }),
      ],
    });
  },
};

// ---------------------------------------------------------------------------
// $firstmarry / $fm / /firstmarry
// ---------------------------------------------------------------------------

const firstmarryArgs = z.object({ query: queryText });

export const firstmarryCommand: CommandDefinition<typeof firstmarryArgs> = {
  name: "firstmarry",
  aliases: ["fm"],
  category: "collection",
  descriptionKey: "help.commands.firstmarry",
  args: firstmarryArgs,
  cooldownMs: 2_000,
  parseArgs: (tokens) => ({ query: tokens.join(" ") }),
  slash: () =>
    slashBase("firstmarry", "help.commands.firstmarry").addStringOption((o) =>
      describe(o, SLASH_TEXT.name).setRequired(true).setAutocomplete(true)
    ),
  slashArgs: (interaction) => ({ query: optionValue(interaction, "name") }),
  autocomplete: ownPactAutocomplete,
  async execute(ctx) {
    const { query } = ctx.args;
    if (!query || query.toLowerCase() === "none") {
      throw new UserError("collection.firstmarry_usage", { prefix: usagePrefix(ctx) });
    }
    const pact = await requireOwnPact(ctx, query);
    await setLeader(ctx.guild.id, ctx.user.id, pact.pactId, safeText(query));
    await ctx.reply({
      embeds: [
        successEmbed({
          description: ctx.t("collection.firstmarry_success", { entity: safeText(pact.name) }),
          footer: false,
        }),
      ],
    });
  },
};

// ---------------------------------------------------------------------------
// $give / $dar / /give
// ---------------------------------------------------------------------------

const giveArgs = z.object({ target: userRefSchema.optional(), query: queryText });

export const giveCommand: CommandDefinition<typeof giveArgs> = {
  name: "give",
  aliases: ["dar"],
  category: "collection",
  descriptionKey: "help.commands.give",
  args: giveArgs,
  cooldownMs: 3_000,
  parseArgs(tokens, { message }) {
    const target = mentionedUser(message, tokens);
    // Remove o token da mencao; o resto e o nome da entidade.
    const index = tokens.findIndex((tok) => userIdFromToken(tok) === target?.id);
    const rest = index === -1 ? tokens : [...tokens.slice(0, index), ...tokens.slice(index + 1)];
    return { target, query: rest.join(" ") };
  },
  slash: () =>
    slashBase("give", "help.commands.give")
      .addUserOption((o) => describe(o, SLASH_TEXT.target).setRequired(true))
      .addStringOption((o) => describe(o, SLASH_TEXT.name).setRequired(true).setAutocomplete(true)),
  slashArgs: (interaction) => ({
    target: optionUser(interaction, "user"),
    query: optionValue(interaction, "name"),
  }),
  autocomplete: ownPactAutocomplete,
  async execute(ctx) {
    const prefix = usagePrefix(ctx);
    const { target, query } = ctx.args;
    if (!target) throw new UserError("collection.give_usage_mention", { prefix });
    if (target.id === ctx.user.id) throw new UserError("collection.give_self");
    if (target.bot) throw new UserError("errors.invalid_user");
    if (!query) throw new UserError("collection.give_usage_name", { prefix });

    const recipient = await resolveUser(ctx, target);
    if (!recipient || recipient.bot) throw new UserError("errors.invalid_user");

    const pact = await requireOwnPact(ctx, query);
    await giveEntity({
      guildId: ctx.guild.id,
      fromUserId: ctx.user.id,
      to: { id: recipient.id, username: recipient.name },
      pactId: pact.pactId,
      label: safeText(query),
    });
    await ctx.reply({
      content: ctx.t("collection.give_success", {
        from: safeText(ctx.user.displayName ?? ctx.user.username, 40),
        entity: safeText(pact.name),
        toId: recipient.id,
      }),
      allowedMentions: { users: [recipient.id] },
    });
  },
};

// ---------------------------------------------------------------------------
// $trade / $trocar / $troca / /trade
// ---------------------------------------------------------------------------

const tradeArgs = z.object({
  target: userRefSchema.optional(),
  query: queryText,
});

export const tradeCommand: CommandDefinition<typeof tradeArgs> = {
  name: "trade",
  aliases: ["trocar", "troca"],
  category: "collection",
  descriptionKey: "help.commands.trade",
  args: tradeArgs,
  cooldownMs: 3_000,
  parseArgs(tokens, { message }) {
    const target = mentionedUser(message, tokens);
    const index = tokens.findIndex((tok) => userIdFromToken(tok) === target?.id);
    const rest = index === -1 ? tokens : [...tokens.slice(0, index), ...tokens.slice(index + 1)];
    return { target, query: rest.join(" ").trim() };
  },
  slash: () =>
    slashBase("trade", "help.commands.trade")
      .addUserOption((o) => describe(o, SLASH_TEXT.tradeTarget).setRequired(false))
      .addStringOption((o) =>
        describe(o, SLASH_TEXT.tradeMyCard).setRequired(false).setAutocomplete(true)
      )
      .addStringOption((o) =>
        describe(o, SLASH_TEXT.tradeTheirCard).setRequired(false)
      ),
  slashArgs: (interaction) => {
    const target = optionUser(interaction, "user");
    const myCard = typeof optionValue(interaction, "my_card") === "string" ? String(optionValue(interaction, "my_card")).trim() : "";
    const theirCard = typeof optionValue(interaction, "their_card") === "string" ? String(optionValue(interaction, "their_card")).trim() : "";
    let query = "";
    if (myCard && theirCard) {
      query = `${myCard} : ${theirCard}`;
    } else if (myCard) {
      query = myCard;
    }
    return { target, query };
  },
  autocomplete: ownPactAutocomplete,
  async execute(ctx) {
    const prefix = usagePrefix(ctx);
    const { target, query } = ctx.args;

    // Caso 1: Sem alvo especificado -> Abre menu para selecionar membro
    if (!target) {
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(ctx.t("collection.trade_pick_user_title"))
            .setDescription(ctx.t("collection.trade_pick_user_desc", { prefix }))
            .setColor(0x3b82f6),
        ],
        components: [buildPickUserComponents(ctx.user.id, ctx.locale)],
      });
      return;
    }

    // Validacoes do alvo
    if (target.id === ctx.user.id) throw new UserError("collection.trade_self");
    if (target.bot) throw new UserError("collection.trade_bot");

    const recipient = await resolveUser(ctx, target);
    if (!recipient || recipient.bot) throw new UserError("collection.trade_bot");
    if (recipient.id === ctx.user.id) throw new UserError("collection.trade_self");

    // Processamento das cartas (se informadas no texto)
    let pactA: OwnPact | null = null;
    let pactB: OwnPact | null = null;

    if (query) {
      if (query.includes(":")) {
        const [left, ...rightParts] = query.split(":");
        const myName = left.trim();
        const theirName = rightParts.join(":").trim();

        if (myName) {
          pactA = await findOwnPact(ctx.guild.id, ctx.user.id, myName);
          if (!pactA) throw new UserError("errors.not_in_pantheon", { query: safeText(myName) });
        }
        if (theirName) {
          pactB = await findOwnPact(ctx.guild.id, recipient.id, theirName);
          if (!pactB) {
            throw new UserError("collection.trade_target_not_owned", {
              user: safeText(recipient.name),
              query: safeText(theirName),
            });
          }
        }
      } else {
        pactA = await findOwnPact(ctx.guild.id, ctx.user.id, query);
        if (!pactA) throw new UserError("errors.not_in_pantheon", { query: safeText(query) });
      }
    }

    const session = createTradeSession({
      guildId: ctx.guild.id,
      channelId: ctx.message?.channelId ?? ctx.interaction?.channelId ?? "",
      userA: {
        id: ctx.user.id,
        username: ctx.user.displayName || ctx.user.username,
        pact: pactA
          ? {
              pactId: pactA.pactId,
              entityId: pactA.entityId,
              name: pactA.name,
              series: null,
              variant: pactA.variant,
              value: pactA.value,
            }
          : null,
        accepted: Boolean(pactA && pactB),
      },
      userB: {
        id: recipient.id,
        username: recipient.name,
        pact: pactB
          ? {
              pactId: pactB.pactId,
              entityId: pactB.entityId,
              name: pactB.name,
              series: null,
              variant: pactB.variant,
              value: pactB.value,
            }
          : null,
        accepted: false,
      },
      locale: ctx.locale,
    });

    const components = await buildTradeComponents(session);
    const reply = await ctx.reply({
      content: `<@${recipient.id}>`,
      embeds: [buildTradeEmbed(session)],
      components,
      allowedMentions: { users: [recipient.id] },
    });

    if (reply && typeof reply === "object" && "edit" in reply) {
      session.message = reply as Message;
    }
  },
};

// ---------------------------------------------------------------------------
// $note / $nota e $alias / $alias2
// ---------------------------------------------------------------------------

/** `Zero Two $ minha waifu` -> nome antes do primeiro `$`, texto depois (pode conter outros `$`). */
export function splitNameAndText(tokens: readonly string[]): { name: string; text: string } {
  const raw = tokens.join(" ");
  const index = raw.indexOf("$");
  if (index === -1) return { name: raw.trim(), text: "" };
  return { name: raw.slice(0, index).trim(), text: raw.slice(index + 1).trim() };
}

const noteArgs = z.object({ name: queryText, text: z.string().trim().max(400).default("") });

export const noteCommand: CommandDefinition<typeof noteArgs> = {
  name: "note",
  aliases: ["nota"],
  category: "collection",
  descriptionKey: "help.commands.note",
  args: noteArgs,
  cooldownMs: 2_000,
  parseArgs: (tokens) => splitNameAndText(tokens),
  slash: () =>
    slashBase("note", "help.commands.note")
      .addStringOption((o) => describe(o, SLASH_TEXT.name).setRequired(true).setAutocomplete(true))
      .addStringOption((o) => describe(o, SLASH_TEXT.note).setMaxLength(400)),
  slashArgs: (interaction) => ({
    name: optionValue(interaction, "name"),
    text: optionValue(interaction, "text"),
  }),
  autocomplete: ownPactAutocomplete,
  async execute(ctx) {
    const { name, text } = ctx.args;
    if (!name) throw new UserError("collection.note_usage", { prefix: usagePrefix(ctx) });
    const pact = await requireOwnPact(ctx, name);
    await setPactText({
      guildId: ctx.guild.id,
      userId: ctx.user.id,
      pactId: pact.pactId,
      field: "note",
      value: text,
      label: safeText(name),
    });
    await ctx.reply({
      embeds: [
        successEmbed({
          description: ctx.t("collection.note_success", {
            entity: safeText(pact.name),
            note: text ? safeText(text, 200) : ctx.t("collection.note_none"),
          }),
          footer: false,
        }),
      ],
    });
  },
};

const aliasArgs = z.object({
  name: queryText,
  text: z.string().trim().max(100).default(""),
  slot: z.coerce.number().int().min(1).max(2).default(1),
});

export const aliasCommand: CommandDefinition<typeof aliasArgs> = {
  name: "alias",
  aliases: ["alias2"],
  category: "collection",
  descriptionKey: "help.commands.alias",
  args: aliasArgs,
  cooldownMs: 2_000,
  parseArgs(tokens, { invokedAs }) {
    return { ...splitNameAndText(tokens), slot: invokedAs === "alias2" ? 2 : 1 };
  },
  slash: () =>
    slashBase("alias", "help.commands.alias")
      .addStringOption((o) => describe(o, SLASH_TEXT.name).setRequired(true).setAutocomplete(true))
      .addStringOption((o) => describe(o, SLASH_TEXT.alias).setRequired(true).setMaxLength(100))
      .addIntegerOption((o) => describe(o, SLASH_TEXT.slot).setMinValue(1).setMaxValue(2)),
  slashArgs: (interaction) => ({
    name: optionValue(interaction, "name"),
    text: optionValue(interaction, "text"),
    slot: optionValue(interaction, "slot"),
  }),
  autocomplete: ownPactAutocomplete,
  async execute(ctx) {
    const { name, text, slot } = ctx.args;
    if (!name || !text) throw new UserError("collection.alias_usage", { prefix: usagePrefix(ctx) });
    const pact = await requireOwnPact(ctx, name);
    await setPactText({
      guildId: ctx.guild.id,
      userId: ctx.user.id,
      pactId: pact.pactId,
      field: slot === 2 ? "alias2" : "alias",
      value: text,
      label: safeText(name),
    });
    await ctx.reply({
      embeds: [
        successEmbed({
          description: ctx.t("collection.alias_success", {
            entity: safeText(pact.name),
            alias: safeText(text, 60),
          }),
          footer: false,
        }),
      ],
    });
  },
};

// ---------------------------------------------------------------------------
// $custompic / $c / /custompic
// ---------------------------------------------------------------------------

function parseCustompicArgs(
  tokens: readonly string[],
  extra?: { message?: Message }
): { name: string; url: string; reset: boolean } {
  const attachmentUrl = extra?.message?.attachments?.first()?.url ?? "";

  const hasDollar = tokens.some((t) => t.includes("$"));
  if (hasDollar) {
    const { name, text } = splitNameAndText(tokens);
    const trimmed = text.trim();
    if (
      trimmed.toLowerCase() === "remove" ||
      trimmed.toLowerCase() === "reset" ||
      trimmed.toLowerCase() === "remover"
    ) {
      return { name, url: "", reset: true };
    }
    return { name, url: trimmed || attachmentUrl, reset: false };
  }

  if (attachmentUrl && tokens.length > 0) {
    return { name: tokens.join(" ").trim(), url: attachmentUrl, reset: false };
  }

  if (tokens.length === 0) {
    return { name: "", url: "", reset: false };
  }

  const last = tokens[tokens.length - 1]!;
  if (
    tokens.length > 1 &&
    (last.toLowerCase() === "remove" ||
      last.toLowerCase() === "reset" ||
      last.toLowerCase() === "remover")
  ) {
    return { name: tokens.slice(0, -1).join(" ").trim(), url: "", reset: true };
  }

  if (tokens.length > 1 && /^https?:\/\//i.test(last)) {
    return { name: tokens.slice(0, -1).join(" ").trim(), url: last, reset: false };
  }

  return { name: tokens.join(" ").trim(), url: attachmentUrl, reset: false };
}

const custompicArgs = z.object({
  name: queryText,
  url: z.string().trim().default(""),
  reset: z.boolean().default(false),
});

export const custompicCommand: CommandDefinition<typeof custompicArgs> = {
  name: "custompic",
  aliases: ["c", "customimage"],
  category: "collection",
  descriptionKey: "help.commands.custompic",
  args: custompicArgs,
  cooldownMs: 2_000,
  parseArgs: (tokens, extra) => parseCustompicArgs(tokens, extra),
  slash: () =>
    slashBase("custompic", "help.commands.custompic")
      .addStringOption((o) => describe(o, SLASH_TEXT.name).setRequired(true).setAutocomplete(true))
      .addStringOption((o) => describe(o, SLASH_TEXT.custompicUrl))
      .addBooleanOption((o) => describe(o, SLASH_TEXT.custompicReset)),
  slashArgs: (interaction) => {
    const reset = Boolean(optionValue(interaction, "reset"));
    const url = String(optionValue(interaction, "url") ?? "").trim();
    return {
      name: optionValue(interaction, "name"),
      url,
      reset,
    };
  },
  autocomplete: ownPactAutocomplete,
  async execute(ctx) {
    const { name, url, reset } = ctx.args;
    const prefix = usagePrefix(ctx);
    if (!name || (!url && !reset)) {
      throw new UserError("collection.custompic_usage", { prefix });
    }

    const pact = await requireOwnPact(ctx, name);

    if (reset) {
      await setPactCustomImage({
        guildId: ctx.guild.id,
        userId: ctx.user.id,
        pactId: pact.pactId,
        imageUrl: null,
        label: safeText(name),
      });
      await ctx.reply({
        embeds: [
          successEmbed({
            description: ctx.t("collection.custompic_removed", { entity: safeText(pact.name) }),
            footer: false,
          }),
        ],
      });
      return;
    }

    try {
      await safeFetchImage(url, { allowAnyPublicHost: true });
    } catch {
      throw new UserError("collection.custompic_invalid_url");
    }

    await setPactCustomImage({
      guildId: ctx.guild.id,
      userId: ctx.user.id,
      pactId: pact.pactId,
      imageUrl: url,
      label: safeText(name),
    });

    await ctx.reply({
      embeds: [
        successEmbed({
          description: ctx.t("collection.custompic_success", { entity: safeText(pact.name) }),
          footer: false,
        }),
      ],
    });
  },
};

// ---------------------------------------------------------------------------
// Exportacao
// ---------------------------------------------------------------------------

export const commands: AnyCommand[] = [
  pantheonCommand,
  infoCommand,
  dissolveCommand,
  firstmarryCommand,
  giveCommand,
  tradeCommand,
  noteCommand,
  aliasCommand,
  custompicCommand,
];

/**
 * Mesmos comandos como registros do registry; o Panteao leva o `matcher` dos atalhos com sufixo
 * de flags (`ptk=`, `ptw`, `pth`, `pty`, `mmw`...), que um `AnyCommand` puro nao consegue carregar.
 */
export const registrations: CommandRegistration[] = commands.map((cmd) =>
  cmd === pantheonCommand ? { cmd, matcher: PANTHEON_SHORTCUT } : { cmd }
);
