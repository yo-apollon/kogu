/**
 * Componentes interativos de Coleção e Panteão.
 * Namespace: "col" (COLLECTION_NAMESPACE).
 * Gerencia a navegação interativa de versões/edições e fotos de cartas do $im / $info.
 */
import { AttachmentBuilder, type MessageComponentInteraction } from "discord.js";
import { renderCardInPool } from "../../canvas/index.js";
import { EDITION_LABEL } from "../../config/gacha.js";
import type { ComponentHandler } from "../../core/contracts.js";
import { t } from "../../i18n/index.js";
import { childLogger } from "../../lib/logger.js";
import { DEFAULT_PACT_LIMIT, buildSummonEmbed } from "../../ui/summonEmbed.js";
import { getGuildBasics } from "../economy/extra.js";
import { getEntityImages, getEntityInfo, resolveEditionForInfo } from "./service.js";
import {
  COLLECTION_NAMESPACE,
  buildInfoActionRows,
  buildInfoView,
  cardRenderInput,
} from "./views.js";

const log = childLogger("collection:components");

export const collectionComponent: ComponentHandler = {
  namespace: COLLECTION_NAMESPACE,

  async handle(interaction: MessageComponentInteraction, parts: string[]): Promise<void> {
    if (!interaction.isButton() || !interaction.guildId) return;

    const action = parts[0];
    const targetEntityId = Number(parts[1]);
    let imgIdx = Math.max(0, Number(parts[2]) || 0);
    const requesterId = parts[3];

    if (!targetEntityId || isNaN(targetEntityId)) return;

    // Apenas im_ed (mudar edição) e im_img (mudar foto) disparam atualização
    if (action !== "im_ed" && action !== "im_img") return;

    await interaction.deferUpdate();

    try {
      let locale = "pt-BR";
      try {
        const basics = await getGuildBasics(interaction.guildId);
        locale = basics.locale;
      } catch {
        locale = "pt-BR";
      }

      const info = await getEntityInfo(interaction.guildId, targetEntityId);
      if (!info) return;

      const { editions } = await resolveEditionForInfo(interaction.guildId, interaction.user.id, targetEntityId, true);
      const images = await getEntityImages(targetEntityId);

      if (images.length > 0) {
        if (imgIdx >= images.length) imgIdx = 0;
        info.imageUrl = images[imgIdx]!.url;
      }

      const ownerAvatarUrl = info.pact
        ? interaction.guild?.members?.cache?.get(info.pact.userId)?.displayAvatarURL()
        : undefined;

      const view = buildInfoView(info, { locale, ownerAvatarUrl });
      const { embed, attachmentName } = buildSummonEmbed(view, {
        locale,
        pactLimit: DEFAULT_PACT_LIMIT,
      });

      const currEdIdx = Math.max(0, editions.findIndex((e) => e.id === targetEntityId));
      const rows = buildInfoActionRows({
        entityId: targetEntityId,
        editions,
        currentEditionIndex: currEdIdx,
        images,
        currentImageIndex: imgIdx,
        userId: requesterId || interaction.user.id,
        locale,
      });

      const files: AttachmentBuilder[] = [];
      try {
        const art = await renderCardInPool(cardRenderInput(info, locale));
        files.push(new AttachmentBuilder(art, { name: attachmentName }));
      } catch (err) {
        log.warn({ err, entityId: targetEntityId }, "falha ao renderizar a carta na navegação do $info");
        embed.setImage(null);
      }

      const content =
        editions.length > 1
          ? t("collection.info_editions", locale, {
              list: editions
                .map((e) => `${t(EDITION_LABEL[e.edition], locale)} (id:${e.id}${e.owned ? " ✅" : ""})`)
                .join(" · "),
            })
          : undefined;

      await interaction.editReply({
        content: content ?? null,
        embeds: [embed],
        components: rows,
        files,
        attachments: [],
      });
    } catch (err) {
      log.error({ err, targetEntityId, action }, "erro ao processar componente de coleção");
    }
  },
};
