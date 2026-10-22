/**
 * Painel com StringSelectMenu para trocar de secao (/settings, /help, /profile).
 *
 * Mesma arquitetura do paginador: estado (dono, secao atual, idioma) no KV em
 * `pn:<id>` com TTL deslizante; os `render()` das secoes ficam em um registry em
 * memoria. customId do select: `pn:<id>:select`. So o autor interage.
 */
import {
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import type { KV } from "../../infra/redis/kv.js";
import { getLocale, t } from "../../i18n/index.js";
import { errorEmbed } from "../embeds.js";
import { assertOwner, newComponentId, PANEL_NS } from "./ownership.js";
import {
  DEFAULT_COMPONENT_TTL_MS,
  disableComponents,
  type AnyRow,
  type EditableMessage,
  type PageContent,
  type PagePayload,
} from "./paginator.js";

export interface PanelSection {
  /** Valor do select; unico dentro do painel. */
  id: string;
  label: string;
  description?: string;
  emoji?: string;
  render(): PageContent | Promise<PageContent>;
}

export interface PanelOptions {
  kv: KV;
  ownerId: string;
  /** De 1 a 25 secoes. */
  sections: PanelSection[];
  /** Secao inicial (padrao: a primeira). */
  initial?: string;
  locale?: Locale;
  placeholder?: string;
  ttlMs?: number;
}

export interface Panel {
  readonly id: string;
  readonly payload: PagePayload;
  attach(message: EditableMessage): void;
  stop(): Promise<void>;
}

interface PanelState {
  ownerId: string;
  section: string;
  locale: Locale;
}

interface PanelRuntime {
  kv: KV;
  ttlMs: number;
  sections: Map<string, PanelSection>;
  render(sectionId: string): Promise<PagePayload>;
  lastPayload?: PagePayload;
  message?: EditableMessage;
  timer?: ReturnType<typeof setTimeout>;
}

const panels = new Map<string, PanelRuntime>();

export function panelKey(id: string): string {
  return `${PANEL_NS}:${id}`;
}

export function activePanels(): number {
  return panels.size;
}

function parseState(raw: string | null): PanelState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    if (typeof parsed.ownerId === "string" && typeof parsed.section === "string") {
      return {
        ownerId: parsed.ownerId,
        section: parsed.section,
        locale: getLocale(parsed.locale),
      };
    }
  } catch {
    // estado corrompido equivale a expirado
  }
  return null;
}

function scheduleExpiry(id: string, rt: PanelRuntime): void {
  if (rt.timer) clearTimeout(rt.timer);
  rt.timer = setTimeout(() => void expire(id), rt.ttlMs);
  rt.timer.unref?.();
}

async function expire(id: string): Promise<void> {
  const rt = panels.get(id);
  if (!rt) return;
  panels.delete(id);
  if (rt.timer) clearTimeout(rt.timer);
  try {
    await rt.kv.del(panelKey(id));
  } catch {
    // o TTL da chave cuida da limpeza
  }
  if (rt.message && rt.lastPayload) {
    try {
      await rt.message.edit({ components: disableComponents(rt.lastPayload.components) });
    } catch {
      // mensagem apagada ou sem permissao
    }
  }
}

export async function createPanel(options: PanelOptions): Promise<Panel> {
  if (options.sections.length === 0 || options.sections.length > 25) {
    throw new RangeError("createPanel: informe de 1 a 25 secoes");
  }
  const locale = options.locale ?? DEFAULT_LOCALE;
  const id = newComponentId();
  const sections = new Map(options.sections.map((s) => [s.id, s]));
  const placeholder = options.placeholder ?? t("ui.panel.placeholder", locale);

  const rt: PanelRuntime = {
    kv: options.kv,
    ttlMs: options.ttlMs ?? DEFAULT_COMPONENT_TTL_MS,
    sections,
    async render(sectionId) {
      const section = sections.get(sectionId) ?? options.sections[0]!;
      const content = await section.render();
      const select = new StringSelectMenuBuilder()
        .setCustomId(`${PANEL_NS}:${id}:select`)
        .setPlaceholder(placeholder)
        .addOptions(
          options.sections.map((s) => ({
            label: s.label.slice(0, 100),
            value: s.id,
            description: s.description?.slice(0, 100),
            emoji: s.emoji,
            default: s.id === section.id,
          }))
        );
      const payload: PagePayload = {
        content: content.content,
        embeds: content.embeds ?? [],
        files: content.files,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select) as AnyRow,
          ...(content.components ?? []),
        ].slice(0, 5),
      };
      rt.lastPayload = payload;
      return payload;
    },
  };

  const initial =
    options.initial && sections.has(options.initial) ? options.initial : options.sections[0]!.id;
  const payload = await rt.render(initial);

  await options.kv.set(
    panelKey(id),
    JSON.stringify({ ownerId: options.ownerId, section: initial, locale } satisfies PanelState),
    { px: rt.ttlMs }
  );
  panels.set(id, rt);
  scheduleExpiry(id, rt);

  return {
    id,
    payload,
    attach(message) {
      rt.message = message;
    },
    stop: () => expire(id),
  };
}

/** Trata o select `pn:<id>:select`. */
export async function handlePanelInteraction(
  kv: KV,
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const [ns, id, action] = interaction.customId.split(":");
  if (ns !== PANEL_NS || !id || action !== "select") return;

  const state = parseState(await kv.get(panelKey(id)));
  const rt = panels.get(id);
  if (!state || !rt) {
    panels.delete(id);
    const locale = state?.locale ?? DEFAULT_LOCALE;
    try {
      await interaction.update({ components: disableComponents(interaction.message.components) });
      await interaction.followUp({
        embeds: [errorEmbed({ description: t("ui.panel.expired", locale), footer: false })],
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // interacao ja respondida
    }
    return;
  }

  if (!(await assertOwner(interaction, state.ownerId, state.locale))) return;

  const chosen = interaction.values[0];
  if (!chosen || !rt.sections.has(chosen)) {
    await interaction.reply({
      embeds: [
        errorEmbed({ description: t("ui.panel.unknown_section", state.locale), footer: false }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const payload = await rt.render(chosen);
  await kv.set(panelKey(id), JSON.stringify({ ...state, section: chosen }), { px: rt.ttlMs });
  scheduleExpiry(id, rt);
  await interaction.update(payload);
}
