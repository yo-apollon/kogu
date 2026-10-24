/**
 * Handler de componentes do painel `/catalog review` (namespace `cr`).
 *
 * Sem estado em memoria nem KV: o item em foco vai no customId (`cr:<acao>:<idDoItem>`) e a fila e
 * lida do banco a cada clique; por isso o painel sobrevive a reinicios e qualquer moderador ve a
 * fila atualizada. Toda interacao exige OWNER_IDS ou linha em catalog_moderators.
 */
import type { ComponentHandler } from "../../core/contracts.js";
import type { DbExecutor } from "../../catalog/executor.js";
import { isOwner } from "../../config/env.js";
import { getLocale, t } from "../../i18n/index.js";
import { db as defaultDb } from "../../infra/db/client.js";
import type { Locale } from "../../config/constants.js";
import {
  approveItem,
  firstPendingId,
  getQueueItem,
  isCatalogModerator,
  neighborPendingId,
  queueCounts,
  rejectItem,
  renameItemEntity,
  setItemGender,
  type ReviewOutcome,
} from "./review.js";
import { applyProvisionalAether, notifyCatalogUpdated } from "./service.js";
import {
  CATALOG_REVIEW_NS,
  errorPayload,
  nameModal,
  outcomeNotice,
  parseReviewParts,
  reviewView,
  type ReviewView,
} from "./views.js";

export interface ReviewHandlerDeps {
  getDb?: () => DbExecutor;
  ownerCheck?: (id: string) => boolean;
  now?: () => Date;
  /** Avisa o pool de sorteio; padrao publica `catalog:updated`. */
  notify?: (source: string) => Promise<void>;
}

/**
 * Monta a view do item em foco. Se `focusId` ja nao esta pendente (decidido agora ou por outro
 * moderador), segue para o proximo pendente depois dele; fila vazia = view vazia.
 */
export async function renderReview(
  db: DbExecutor,
  locale: Locale,
  focusId: number | null,
  notice?: string
): Promise<ReviewView> {
  let item = focusId !== null ? await getQueueItem(db, focusId) : null;
  if (!item || item.status !== "PENDING") {
    const nextId =
      focusId !== null ? await neighborPendingId(db, focusId, "next") : await firstPendingId(db);
    item = nextId !== null ? await getQueueItem(db, nextId) : null;
  }
  if (!item) return reviewView({ item: null, position: 0, total: 0, locale, notice });
  const { total, position } = await queueCounts(db, item.id);
  return reviewView({ item, position, total, locale, notice });
}

export function createReviewHandler(deps: ReviewHandlerDeps = {}): ComponentHandler {
  const getDb = deps.getDb ?? (() => defaultDb as unknown as DbExecutor);
  const ownerCheck = deps.ownerCheck ?? isOwner;
  const now = deps.now ?? (() => new Date());
  const notify = deps.notify ?? ((source: string) => notifyCatalogUpdated(source));

  /** Publica a mudanca e calcula o Eter provisorio de quem acabou de ativar. */
  async function afterDecision(db: DbExecutor, outcome: ReviewOutcome): Promise<void> {
    if (!outcome.ok) return;
    const changed = outcome.activated || outcome.disabled || outcome.action === "merged";
    if (outcome.activated && outcome.entityId !== null) {
      await applyProvisionalAether(db, outcome.entityId).catch(() => null);
    }
    if (changed) await notify("review");
  }

  return {
    namespace: CATALOG_REVIEW_NS,
    async handle(interaction, parts) {
      const parsed = parseReviewParts(parts);
      if (!parsed) return;
      const { control, itemId } = parsed;
      const locale = getLocale(interaction.locale);
      const db = getDb();

      if (!(await isCatalogModerator(db, interaction.user.id, ownerCheck))) {
        await interaction.reply(errorPayload(locale, t("common.no_permission", locale)));
        return;
      }
      const reviewer = interaction.user.id;

      // ---- modal "corrigir nome": abre sem defer (showModal precisa ser a 1a resposta) ----
      if (control === "nm") {
        if (!interaction.isButton()) return;
        const item = await getQueueItem(db, itemId);
        if (!item || item.status !== "PENDING" || !item.entity) {
          await interaction.deferUpdate();
          await interaction.editReply(await renderReview(db, locale, itemId, outcomeNotice({ ok: false, code: "stale" }, itemId, locale)));
          return;
        }
        await interaction.showModal(nameModal(itemId, item.entity.name, locale));
        return;
      }

      if (control === "ind") {
        if (interaction.isButton()) await interaction.deferUpdate();
        return;
      }

      // Demais acoes tocam o banco: reconhece em ate 3 s e edita a mensagem depois.
      if (control === "nmm") {
        if (!interaction.isModalSubmit()) return;
        await interaction.deferUpdate();
        const outcome = await renameItemEntity(
          db,
          itemId,
          interaction.fields.getTextInputValue("name"),
          reviewer,
          { now: now() }
        );
        await afterDecision(db, outcome);
        await interaction.editReply(
          await renderReview(db, locale, itemId, outcomeNotice(outcome, itemId, locale))
        );
        return;
      }

      if (control === "gn") {
        if (!interaction.isStringSelectMenu()) return;
        await interaction.deferUpdate();
        const outcome = await setItemGender(db, itemId, interaction.values[0] ?? "", reviewer, {
          now: now(),
        });
        await afterDecision(db, outcome);
        await interaction.editReply(
          await renderReview(db, locale, itemId, outcomeNotice(outcome, itemId, locale))
        );
        return;
      }

      if (!interaction.isButton()) return;
      await interaction.deferUpdate();

      if (control === "prev" || control === "next") {
        const target = await neighborPendingId(db, itemId, control);
        await interaction.editReply(await renderReview(db, locale, target));
        return;
      }

      // ok / no
      const outcome =
        control === "ok"
          ? await approveItem(db, itemId, reviewer, { now: now() })
          : await rejectItem(db, itemId, reviewer, { now: now() });
      await afterDecision(db, outcome);
      // Decidido: o item saiu da fila e `renderReview` segue para o proximo. Bloqueado
      // (genero/imagem) continua pendente e o painel permanece nele.
      await interaction.editReply(
        await renderReview(db, locale, itemId, outcomeNotice(outcome, itemId, locale))
      );
    },
  };
}

export const reviewHandler: ComponentHandler = createReviewHandler();
