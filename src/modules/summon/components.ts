/**
 * Botoes da invocacao: namespace `sm`, customIds `sm:pact|like|orb:<offerId>`.
 *
 * O estado vive em `roll_offers` (persistente), entao os botoes funcionam depois de reinicios.
 * Toda a regra (protecao, janela de pactos, atomicidade) esta em offers.ts; aqui so se traduz
 * o resultado em resposta do Discord.
 *
 * Regra de resposta: cada interacao recebe EXATAMENTE uma resposta.
 *  - sucesso de pacto/orbe: `interaction.update` (se a interacao ja expirou, `message.edit`) + anuncio no canal;
 *  - like e erros esperados (`UserError`): `reply` efemero;
 *  - erro inesperado: relancado, e o roteador responde com o `errorId`.
 */
import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type MessageEditOptions,
} from "discord.js";
import type { Locale } from "../../config/constants.js";
import type { ComponentHandler } from "../../core/contracts.js";
import { UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import { errorEmbed } from "../../ui/embeds.js";
import { escapeMarkdown, formatNumber, truncate } from "../../ui/format.js";
import { DEFAULT_OWNER_COLOR, DEFAULT_PACT_LIMIT } from "../../ui/summonEmbed.js";
import { claimOrb, claimPact, getOffer, likeEntity } from "./offers.js";
import {
  claimedRow,
  describeUserError,
  guildLocale,
  loadEntityName,
  loadMemberColor,
  loadPactPosition,
  orbDoneRow,
  tr,
} from "./views.js";

const log = childLogger("summon:components");

export const SUMMON_NAMESPACE = "sm";
export const SUMMON_ACTIONS = ["pact", "like", "orb"] as const;
type SummonAction = (typeof SUMMON_ACTIONS)[number];

/** `claimPact` grava o pacto novo com 1 Selo de Despertar. */
const CLAIM_INITIAL_KEYS = 1;

export interface SummonComponentDeps {
  claimPact: typeof claimPact;
  claimOrb: typeof claimOrb;
  likeEntity: typeof likeEntity;
  getOffer: typeof getOffer;
  localeOf(guildId: string | null): Promise<Locale>;
  memberColor(guildId: string, userId: string): Promise<number | undefined>;
  pactPosition(pact: { id: number; guildId: string; userId: string }): Promise<number>;
  entityName(entityId: number): Promise<string | undefined>;
}

export const defaultComponentDeps: SummonComponentDeps = {
  claimPact,
  claimOrb,
  likeEntity,
  getOffer,
  localeOf: guildLocale,
  memberColor: loadMemberColor,
  pactPosition: loadPactPosition,
  entityName: loadEntityName,
};

// ---------------------------------------------------------------------------
// Respostas seguras
// ---------------------------------------------------------------------------

function discordCode(err: unknown): number | string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" || typeof code === "string" ? code : undefined;
}

/** Resposta efemera unica; se a interacao ja expirou (10062) ou foi respondida, so loga. */
async function replyEphemeral(
  interaction: ButtonInteraction,
  payload: Pick<InteractionReplyOptions, "content" | "embeds">
): Promise<void> {
  const options: InteractionReplyOptions = {
    ...payload,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(options);
    else await interaction.reply(options);
  } catch (err) {
    log.warn({ err, code: discordCode(err) }, "nao foi possivel responder a interacao");
  }
}

async function replyError(
  interaction: ButtonInteraction,
  err: UserError,
  locale: Locale
): Promise<void> {
  await replyEphemeral(interaction, {
    embeds: [errorEmbed({ description: describeUserError(err, locale), locale, footer: false })],
  });
}

/**
 * Atualiza a mensagem do clique. Interacao expirada/ja respondida: edita pela API do bot
 * (`message.edit` nao depende do token da interacao). Devolve se alguma das vias funcionou.
 */
async function updateMessage(
  interaction: ButtonInteraction,
  payload: InteractionUpdateOptions & MessageEditOptions
): Promise<boolean> {
  try {
    await interaction.update(payload);
    return true;
  } catch (err) {
    log.warn({ err, code: discordCode(err) }, "interaction.update falhou; tentando message.edit");
  }
  try {
    await interaction.message.edit(payload);
    return true;
  } catch (err) {
    log.warn({ err, code: discordCode(err) }, "nao foi possivel atualizar a mensagem da oferta");
    return false;
  }
}

async function announce(interaction: ButtonInteraction, content: string): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function") return;
  try {
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (err) {
    log.warn({ err, code: discordCode(err) }, "nao foi possivel anunciar no canal");
  }
}

async function optional<T>(fn: () => Promise<T>, what: string): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ err }, `falha ao ${what}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Acoes
// ---------------------------------------------------------------------------

/** Nome da entidade: do proprio embed da mensagem (zero custo) ou, na falta, do banco. */
async function entityNameFor(
  interaction: ButtonInteraction,
  deps: SummonComponentDeps,
  entityId: number
): Promise<string> {
  const fromEmbed = interaction.message.embeds[0]?.author?.name;
  if (fromEmbed) return fromEmbed;
  return (await optional(() => deps.entityName(entityId), "buscar o nome da entidade")) ?? "?";
}

async function onPact(
  interaction: ButtonInteraction,
  offerId: number,
  deps: SummonComponentDeps,
  locale: Locale
): Promise<void> {
  const user = interaction.user;
  let claimed;
  try {
    claimed = await deps.claimPact(offerId, user.id, { username: user.username });
  } catch (err) {
    if (err instanceof UserError) return replyError(interaction, err, locale);
    throw err;
  }

  const [color, position, entityName] = await Promise.all([
    optional(() => deps.memberColor(claimed.guildId, user.id), "buscar a cor do membro"),
    optional(
      () => deps.pactPosition({ id: claimed.pactId, guildId: claimed.guildId, userId: user.id }),
      "buscar a posicao do pacto"
    ),
    entityNameFor(interaction, deps, claimed.entityId),
  ]);

  // Mesmo embed (arte e linhas de rank intactas): so cor e rodape passam a ser do dono.
  const current = interaction.message.embeds[0];
  const embed = current ? EmbedBuilder.from(current) : new EmbedBuilder();
  embed.setColor(color ?? DEFAULT_OWNER_COLOR).setFooter({
    text: tr("summon.belongs_to", locale, {
      owner: truncate(user.username, 64),
      keys: CLAIM_INITIAL_KEYS,
      limit: DEFAULT_PACT_LIMIT,
      pos: position ?? 1,
    }),
    iconURL: user.displayAvatarURL(),
  });

  await updateMessage(interaction, {
    embeds: [embed],
    components: [claimedRow(offerId, user.username, locale)],
  });
  await announce(
    interaction,
    tr("summon.pact_announce", locale, {
      user: escapeMarkdown(user.username),
      entity: escapeMarkdown(entityName),
      variant: claimed.variant,
      aether: formatNumber(claimed.aetherValue, locale),
    })
  );
}

async function onLike(
  interaction: ButtonInteraction,
  offerId: number,
  deps: SummonComponentDeps,
  locale: Locale
): Promise<void> {
  const offer = await deps.getOffer(offerId);
  if (!offer) {
    await replyError(interaction, new UserError("errors.expired"), locale);
    return;
  }
  let liked;
  try {
    liked = await deps.likeEntity(interaction.user.id, offer.entityId, {
      username: interaction.user.username,
    });
  } catch (err) {
    if (err instanceof UserError) return replyError(interaction, err, locale);
    throw err;
  }
  const entity = escapeMarkdown(await entityNameFor(interaction, deps, offer.entityId));
  await replyEphemeral(interaction, {
    content: tr(liked.added ? "summon.like_added" : "summon.like_already", locale, { entity }),
  });
}

async function onOrb(
  interaction: ButtonInteraction,
  offerId: number,
  deps: SummonComponentDeps,
  locale: Locale
): Promise<void> {
  const user = interaction.user;
  let orb;
  try {
    orb = await deps.claimOrb(offerId, user.id, { username: user.username });
  } catch (err) {
    if (err instanceof UserError) return replyError(interaction, err, locale);
    throw err;
  }
  const entityName = await entityNameFor(interaction, deps, orb.entityId);

  // Sem tocar no embed: so o botao vira o rotulo "absorvido" (e o sweeper nao o sobrescreve).
  await updateMessage(interaction, {
    components: [orbDoneRow(offerId, user.username, orb.amount, locale)],
  });
  await announce(
    interaction,
    tr("summon.orb_announce", locale, {
      user: escapeMarkdown(user.username),
      amount: formatNumber(orb.amount, locale),
      entity: escapeMarkdown(entityName),
    })
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function parseOfferId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isAction(raw: string | undefined): raw is SummonAction {
  return (SUMMON_ACTIONS as readonly string[]).includes(raw ?? "");
}

export function createSummonComponentHandler(
  deps: SummonComponentDeps = defaultComponentDeps
): ComponentHandler {
  return {
    namespace: SUMMON_NAMESPACE,
    async handle(interaction, parts) {
      if (!interaction.isButton()) return;
      const locale = await deps.localeOf(interaction.guildId);
      const [action, rawId] = parts;
      const offerId = parseOfferId(rawId);
      // `sm:done|orbdone|expired` sao botoes desabilitados; chegar aqui e um id forjado ou antigo.
      if (offerId === null || !isAction(action)) {
        await replyError(interaction, new UserError("errors.expired"), locale);
        return;
      }
      switch (action) {
        case "pact":
          return onPact(interaction, offerId, deps, locale);
        case "like":
          return onLike(interaction, offerId, deps, locale);
        case "orb":
          return onOrb(interaction, offerId, deps, locale);
      }
    },
  };
}

export const summonComponentHandler: ComponentHandler = createSummonComponentHandler();
