/**
 * Paginador generico com botoes (primeira/anterior/ir/proxima/ultima).
 *
 * Arquitetura:
 *  - O ESTADO (dono, pagina atual, total, idioma) fica no KV em `pg:<id>` com TTL
 *    deslizante (renovado a cada clique). E ele quem decide se a interface expirou.
 *  - O CONTEUDO (`items`/`loader` + `renderPage`) fica em um registry em memoria do
 *    processo, pois sao closures. Se o processo reiniciar, o registry some: o proximo
 *    clique cai no caminho "expirou" (botoes desabilitados + aviso ephemeral).
 *  - customIds: `pg:<id>:first|prev|next|last|jump` e modal `pg:<id>:jumpmodal`.
 *  - Roteamento: o roteador global chama `handlePaginatorInteraction(kv, interaction)`
 *    para qualquer customId com namespace `pg`.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type AttachmentBuilder,
  type ButtonInteraction,
  type EmbedBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import type { KV } from "../../infra/redis/kv.js";
import { getLocale, t } from "../../i18n/index.js";
import { emoji } from "../emojis.js";
import { errorEmbed } from "../embeds.js";
import { assertOwner, newComponentId, PAGINATOR_NS } from "./ownership.js";

export const DEFAULT_COMPONENT_TTL_MS = 15 * 60 * 1000;
const MAX_ROWS = 5;

export type AnyRow = ActionRowBuilder<any>;

/** Conteudo de uma pagina devolvido por `renderPage`. */
export interface PageContent {
  content?: string;
  embeds?: Array<EmbedBuilder | APIEmbed>;
  files?: AttachmentBuilder[];
  /** Linhas extras (ate 4), exibidas abaixo da navegacao. */
  components?: AnyRow[];
}

/** Payload pronto para `reply`/`edit`/`update`. */
export interface PagePayload {
  content?: string;
  embeds: Array<EmbedBuilder | APIEmbed>;
  files?: AttachmentBuilder[];
  components: AnyRow[];
}

/** Mensagem cuja linha de componentes pode ser editada ao expirar. */
export interface EditableMessage {
  edit(options: { components: AnyRow[] }): Promise<unknown>;
}

export interface PageSlice<T> {
  items: T[];
  total: number;
}

interface PaginatorBaseOptions<T> {
  kv: KV;
  ownerId: string;
  /** Itens por pagina (minimo 1). */
  pageSize: number;
  renderPage(items: T[], page: number, totalPages: number, total: number): PageContent;
  locale?: Locale;
  /** Vida da interface; renovada a cada clique. Padrao 15 min. */
  ttlMs?: number;
}

export type PaginatorOptions<T> = PaginatorBaseOptions<T> &
  (
    | { items: readonly T[]; loader?: undefined }
    /** `loader(page, pageSize)` com `page` base 1; devolve a fatia e o total geral. */
    | { loader: (page: number, pageSize: number) => Promise<PageSlice<T>>; items?: undefined }
  );

export interface Paginator {
  readonly id: string;
  readonly totalPages: number;
  /** Primeira pagina, pronta para `ctx.reply(payload)`. */
  readonly payload: PagePayload;
  /** Registra a mensagem enviada para desabilitar os botoes ao expirar. */
  attach(message: EditableMessage): void;
  /** Encerra agora: apaga o estado e desabilita os botoes. */
  stop(): Promise<void>;
}

interface PaginatorState {
  ownerId: string;
  page: number;
  totalPages: number;
  locale: Locale;
}

interface Runtime {
  kv: KV;
  ttlMs: number;
  totalPages: number;
  render(page: number): Promise<{ payload: PagePayload; page: number; totalPages: number }>;
  lastPayload?: PagePayload;
  message?: EditableMessage;
  timer?: ReturnType<typeof setTimeout>;
}

const runtimes = new Map<string, Runtime>();

export function paginatorKey(id: string): string {
  return `${PAGINATOR_NS}:${id}`;
}

/** Quantidade de paginadores ativos neste processo (diagnostico/testes). */
export function activePaginators(): number {
  return runtimes.size;
}

/**
 * Devolve copias das linhas com todos os componentes desabilitados. Aceita
 * builders, `ActionRow` de mensagens recebidas ou JSON da API.
 */
export function disableComponents(
  rows: ReadonlyArray<AnyRow | { toJSON(): unknown } | Record<string, unknown>>
): AnyRow[] {
  return rows.map((row) => {
    const data = typeof (row as any).toJSON === "function" ? (row as any).toJSON() : row;
    const copy = ActionRowBuilder.from(data as any) as AnyRow;
    for (const component of copy.components as any[]) component.setDisabled?.(true);
    return copy;
  });
}

function navRow(
  id: string,
  page: number,
  totalPages: number,
  locale: Locale,
  disabled = false
): ActionRowBuilder<ButtonBuilder> {
  const atStart = page <= 1;
  const atEnd = page >= totalPages;
  const cid = (action: string) => `${PAGINATOR_NS}:${id}:${action}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid("first"))
      .setEmoji(emoji("nav.first"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atStart),
    new ButtonBuilder()
      .setCustomId(cid("prev"))
      .setEmoji(emoji("nav.prev"))
      .setLabel(t("ui.paginator.prev", locale))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atStart),
    new ButtonBuilder()
      .setCustomId(cid("jump"))
      .setEmoji(emoji("nav.jump"))
      .setLabel(`${page}/${totalPages}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(cid("next"))
      .setEmoji(emoji("nav.next"))
      .setLabel(t("ui.paginator.next", locale))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atEnd),
    new ButtonBuilder()
      .setCustomId(cid("last"))
      .setEmoji(emoji("nav.last"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atEnd)
  );
}

function jumpModal(id: string, totalPages: number, locale: Locale): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${PAGINATOR_NS}:${id}:jumpmodal`)
    .setTitle(t("ui.paginator.jump_title", locale))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("page")
          .setLabel(t("ui.paginator.jump_label", locale, { total: totalPages }))
          .setPlaceholder(t("ui.paginator.jump_placeholder", locale))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(6)
          .setRequired(true)
      )
    );
}

/** Texto padrao de rodape: "Pagina 2/5". */
export function pageIndicator(page: number, totalPages: number, locale: Locale = DEFAULT_LOCALE) {
  return t("ui.paginator.page", locale, { page, total: totalPages });
}

function buildPayload(
  content: PageContent,
  nav: ActionRowBuilder<ButtonBuilder> | undefined
): PagePayload {
  const rows: AnyRow[] = [...(nav ? [nav] : []), ...(content.components ?? [])].slice(0, MAX_ROWS);
  return {
    content: content.content,
    embeds: content.embeds ?? [],
    files: content.files,
    components: rows,
  };
}

function parseState(raw: string | null): PaginatorState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PaginatorState>;
    if (
      typeof parsed.ownerId === "string" &&
      Number.isInteger(parsed.page) &&
      Number.isInteger(parsed.totalPages)
    ) {
      return {
        ownerId: parsed.ownerId,
        page: parsed.page as number,
        totalPages: parsed.totalPages as number,
        locale: getLocale(parsed.locale),
      };
    }
  } catch {
    // estado corrompido equivale a expirado
  }
  return null;
}

async function saveState(id: string, rt: Runtime, state: PaginatorState): Promise<void> {
  await rt.kv.set(paginatorKey(id), JSON.stringify(state), { px: rt.ttlMs });
}

function scheduleExpiry(id: string, rt: Runtime): void {
  if (rt.timer) clearTimeout(rt.timer);
  rt.timer = setTimeout(() => void expire(id), rt.ttlMs);
  rt.timer.unref?.();
}

async function expire(id: string): Promise<void> {
  const rt = runtimes.get(id);
  if (!rt) return;
  runtimes.delete(id);
  if (rt.timer) clearTimeout(rt.timer);
  try {
    await rt.kv.del(paginatorKey(id));
  } catch {
    // KV indisponivel: o TTL da chave cuida da limpeza
  }
  if (rt.message && rt.lastPayload) {
    try {
      await rt.message.edit({ components: disableComponents(rt.lastPayload.components) });
    } catch {
      // mensagem apagada ou sem permissao
    }
  }
}

/** Cria o paginador, grava o estado no KV e devolve a primeira pagina. */
export async function createPaginator<T>(options: PaginatorOptions<T>): Promise<Paginator> {
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const ttlMs = options.ttlMs ?? DEFAULT_COMPONENT_TTL_MS;
  const locale = options.locale ?? DEFAULT_LOCALE;
  const id = newComponentId();

  let totalPages = 1;
  const rt: Runtime = {
    kv: options.kv,
    ttlMs,
    totalPages,
    async render(requested) {
      let slice: PageSlice<T>;
      if (options.items) {
        const all = options.items;
        totalPages = Math.max(1, Math.ceil(all.length / pageSize));
        const page = Math.min(Math.max(1, requested), totalPages);
        slice = {
          items: all.slice((page - 1) * pageSize, page * pageSize),
          total: all.length,
        };
        return finish(page, slice);
      }
      const first = await options.loader!(Math.max(1, requested), pageSize);
      totalPages = Math.max(1, Math.ceil(first.total / pageSize));
      const page = Math.min(Math.max(1, requested), totalPages);
      slice = page === requested ? first : await options.loader!(page, pageSize);
      return finish(page, slice);
    },
  };

  function finish(page: number, slice: PageSlice<T>) {
    rt.totalPages = totalPages;
    const content = options.renderPage(slice.items, page, totalPages, slice.total);
    const nav = totalPages > 1 ? navRow(id, page, totalPages, locale) : undefined;
    const payload = buildPayload(content, nav);
    rt.lastPayload = payload;
    return { payload, page, totalPages };
  }

  const first = await rt.render(1);

  if (first.totalPages <= 1) {
    return {
      id,
      totalPages: 1,
      payload: first.payload,
      attach() {},
      async stop() {},
    };
  }

  await saveState(id, rt, {
    ownerId: options.ownerId,
    page: first.page,
    totalPages: first.totalPages,
    locale,
  });
  runtimes.set(id, rt);
  scheduleExpiry(id, rt);

  return {
    id,
    totalPages: first.totalPages,
    payload: first.payload,
    attach(message) {
      rt.message = message;
    },
    stop: () => expire(id),
  };
}

type PaginatorInteraction = ButtonInteraction | ModalSubmitInteraction;

async function replyExpired(interaction: PaginatorInteraction, locale: Locale): Promise<void> {
  const notice = {
    embeds: [errorEmbed({ description: t("ui.paginator.expired", locale), footer: false })],
    flags: MessageFlags.Ephemeral,
  } as const;
  if (interaction.isButton()) {
    try {
      await interaction.update({ components: disableComponents(interaction.message.components) });
      await interaction.followUp(notice);
      return;
    } catch {
      // cai para resposta simples
    }
  }
  try {
    await interaction.reply(notice);
  } catch {
    // interacao ja respondida
  }
}

function targetPage(action: string, current: number, total: number): number | null {
  switch (action) {
    case "first":
      return 1;
    case "prev":
      return Math.max(1, current - 1);
    case "next":
      return Math.min(total, current + 1);
    case "last":
      return total;
    default:
      return null;
  }
}

/** Trata botoes `pg:<id>:<acao>` e o modal `pg:<id>:jumpmodal`. */
export async function handlePaginatorInteraction(
  kv: KV,
  interaction: PaginatorInteraction
): Promise<void> {
  const [ns, id, action] = interaction.customId.split(":");
  if (ns !== PAGINATOR_NS || !id || !action) return;

  const state = parseState(await kv.get(paginatorKey(id)));
  const rt = runtimes.get(id);
  if (!state || !rt) {
    runtimes.delete(id);
    await replyExpired(interaction, state?.locale ?? DEFAULT_LOCALE);
    return;
  }

  if (!(await assertOwner(interaction, state.ownerId, state.locale))) return;

  let requested: number;

  if (interaction.isModalSubmit()) {
    if (action !== "jumpmodal") return;
    const raw = interaction.fields.getTextInputValue("page").trim();
    const parsed = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > state.totalPages) {
      await interaction.reply({
        embeds: [
          errorEmbed({
            description: t("ui.paginator.invalid_page", state.locale, { total: state.totalPages }),
            footer: false,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    requested = parsed;
  } else {
    if (action === "jump") {
      await interaction.showModal(jumpModal(id, state.totalPages, state.locale));
      return;
    }
    const next = targetPage(action, state.page, state.totalPages);
    if (next === null) return;
    requested = next;
  }

  const result = await rt.render(requested);
  await saveState(id, rt, { ...state, page: result.page, totalPages: result.totalPages });
  scheduleExpiry(id, rt);

  const payload = result.payload;
  if (interaction.isModalSubmit()) {
    if (interaction.isFromMessage()) await interaction.update(payload);
  } else {
    await interaction.update(payload);
  }
}
