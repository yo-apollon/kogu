import { Message, EmbedBuilder } from "discord.js";
import { db } from "../database/index.js";
import {
  guilds,
  guildProfiles,
  pacts,
  entities,
  disabledSeries,
  customAliases,
  users,
} from "../database/schema.js";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

/**
 * 1. $settings / $serversettings — Painel de configurações do servidor estilo Mudae
 */
export async function handleSettingsCommand(message: Message, guildData: any) {
  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Configurações Dimensionais do Servidor (${message.guild?.name})`)
    .setColor("#5865F2")
    .addFields(
      {
        name: "🎲 Roleta e Invocações",
        value:
          `• **Prefixo ($prefix):** \`${guildData.prefix || "$"}\`\n` +
          `• **Invocações Base ($setrolls):** \`${guildData.baseRolls || 10}\` rolls/hora\n` +
          `• **Modo de Jogo ($gamemode):** Modo \`${guildData.gamemode || 1}\` (1 = Padrão, 2 = Limitado a Raros)`,
        inline: true,
      },
      {
        name: "⏳ Prazos & Proteções",
        value:
          `• **Janela de Pacto ($setclaim):** \`${guildData.claimWindowSeconds || 45}s\`\n` +
          `• **Recarga de Pacto ($settimer):** \`${guildData.claimCooldownMinutes || 180} min\` (3h)\n` +
          `• **Proteção de Snipe ($togglesnipe):** \`${guildData.snipeProtectionSeconds || 8}s\` anti-snipe`,
        inline: true,
      },
      {
        name: "🌐 Idioma & Economia",
        value:
          `• **Idioma ($lang):** \`${guildData.language || "pt-BR"}\`\n` +
          `• **Limite do Panteão ($haremlimit):** \`${guildData.pactLimit || 8100}\` entidades`,
        inline: false,
      }
    )
    .setFooter({
      text: "Para alterar uma configuração, use por exemplo: $setrolls 15 ou $settimer 120",
    });

  return message.reply({ embeds: [embed] });
}

/**
 * 2. $setrolls, $settimer, $setclaim, $gamemode, $prefix — Modificação de Configurações
 */
export async function handleAdminConfigCommands(
  message: Message,
  commandName: string,
  args: string[],
  guildData: any
) {
  if (!message.member?.permissions.has("ManageGuild")) {
    return message.reply("❌ Você precisa da permissão de **Gerenciar Servidor** para alterar estas configurações.");
  }

  const guildId = message.guildId!;
  const val = args[0];

  if (commandName === "setrolls") {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 5 || num > 50) {
      return message.reply("⚠️ Especifique um número de invocações por hora entre **5** e **50**. Exemplo: `$setrolls 15`");
    }
    await db.update(guilds).set({ baseRolls: num }).where(eq(guilds.id, guildId));
    return message.reply(`✅ Invocações base por hora definidas para **${num}**!`);
  }

  if (commandName === "setclaim") {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 10 || num > 120) {
      return message.reply("⚠️ Especifique a janela de tempo para pacto entre **10** e **120** segundos. Exemplo: `$setclaim 60`");
    }
    await db.update(guilds).set({ claimWindowSeconds: num }).where(eq(guilds.id, guildId));
    return message.reply(`✅ Janela de tempo para firmar pacto definida para **${num} segundos**!`);
  }

  if (commandName === "settimer") {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 30 || num > 360) {
      return message.reply("⚠️ Especifique a recarga de pacto entre **30** e **360** minutos. Exemplo: `$settimer 120`");
    }
    await db.update(guilds).set({ claimCooldownMinutes: num }).where(eq(guilds.id, guildId));
    return message.reply(`✅ Tempo de recarga de pacto definido para **${num} minutos**!`);
  }

  if (commandName === "prefix" || commandName === "prefixo") {
    if (!val || val.length > 3) {
      return message.reply("⚠️ Informe um prefixo válido (até 3 caracteres). Exemplo: `$prefix !`");
    }
    await db.update(guilds).set({ prefix: val }).where(eq(guilds.id, guildId));
    return message.reply(`✅ Prefixo do servidor atualizado para **\`${val}\`**!`);
  }

  if (commandName === "gamemode") {
    const mode = parseInt(val, 10);
    if (mode !== 1 && mode !== 2) {
      return message.reply("⚠️ Modos válidos: `1` (Catálogo completo padrão) ou `2` (Apenas personagens e itens mais populares / valiosos). Exemplo: `$gamemode 2`");
    }
    await db.update(guilds).set({ gamemode: mode }).where(eq(guilds.id, guildId));
    return message.reply(`✅ Modo de jogo dimensional alterado para **Modo ${mode}**!`);
  }
}

/**
 * 3. $disable, $antidisable, $disablelist — Desativar séries nas rolagens
 */
export async function handleDisableCommand(
  message: Message,
  commandName: string,
  args: string[]
) {
  const guildId = message.guildId!;
  const userId = message.author.id;
  const seriesQuery = args.join(" ").trim();

  if (commandName === "disablelist" || commandName === "dl" || !seriesQuery) {
    const disabled = await db
      .select()
      .from(disabledSeries)
      .where(and(eq(disabledSeries.guildId, guildId), eq(disabledSeries.userId, userId)));

    if (disabled.length === 0) {
      return message.reply("📋 Você não possui nenhuma série desativada. Use `$disable <nome da série>` para desativar.");
    }

    const list = disabled.map((d, i) => `${i + 1}. **${d.seriesName}**`).join("\n");
    const embed = new EmbedBuilder()
      .setTitle(`🚫 Séries Desativadas nas suas Invocações (${disabled.length})`)
      .setDescription(list)
      .setColor("#EF4444")
      .setFooter({ text: "Use $antidisable <série> para reativar uma obra." });

    return message.reply({ embeds: [embed] });
  }

  if (commandName === "antidisable" || commandName === "ad") {
    const existing = await db
      .select()
      .from(disabledSeries)
      .where(
        and(
          eq(disabledSeries.guildId, guildId),
          eq(disabledSeries.userId, userId),
          sql`LOWER(${disabledSeries.seriesName}) LIKE ${`%${seriesQuery.toLowerCase()}%`}`
        )
      );

    if (existing.length === 0) {
      return message.reply(`❌ Nenhuma série encontrada na sua lista de desativação para **"${seriesQuery}"**.`);
    }

    for (const item of existing) {
      await db.delete(disabledSeries).where(eq(disabledSeries.id, item.id));
    }

    return message.reply(`✅ A série **${existing[0].seriesName}** foi reativada nas suas rolagens!`);
  }

  // $disable <série>
  const id = crypto.randomUUID();
  await db.insert(disabledSeries).values({
    id,
    guildId,
    userId,
    seriesName: seriesQuery,
    isServerWide: false,
  });

  return message.reply(
    `🚫 A série **${seriesQuery}** foi desativada nas suas invocações! Personagens dessa obra não aparecerão mais nos seus rolls.`
  );
}

/**
 * 4. $firstmarry / $fm <nome> — Define o favorito e líder do Panteão
 */
export async function handleFirstMarryCommand(message: Message, args: string[]) {
  const query = args.join(" ").trim();
  const guildId = message.guildId!;
  const userId = message.author.id;

  if (!query || query.toLowerCase() === "none") {
    return message.reply("🌟 Use `$firstmarry <nome>` para definir seu personagem favorito na primeira posição do seu Panteão.");
  }

  const userPacts = await db
    .select({ pact: pacts, entity: entities })
    .from(pacts)
    .innerJoin(entities, eq(pacts.entityId, entities.id))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)));

  const match = userPacts.find((p) => p.entity.name.toLowerCase().includes(query.toLowerCase()));
  if (!match) {
    return message.reply(`❌ Você não possui **"${query}"** no seu Panteão.`);
  }

  // Coloca sortOrder 9999 para que fique sempre no topo
  await db
    .update(pacts)
    .set({ sortOrder: 9999 })
    .where(eq(pacts.id, match.pact.id));

  return message.reply(
    `👑 **${match.entity.name}** agora é o seu **Líder do Panteão ($fm)**! Ela aparecerá com destaque máximo no seu \`$profile\` e no topo do \`$pt\`!`
  );
}

/**
 * 5. $give <@user> <personagem> — Presentear personagem para outro jogador
 */
export async function handleGiveCommand(message: Message, args: string[]) {
  const targetUser = message.mentions.users.first();
  if (!targetUser) {
    return message.reply("🎁 Mencione o jogador para quem deseja doar a entidade. Exemplo: `$give @amigo Zero Two`");
  }

  if (targetUser.id === message.author.id) {
    return message.reply("❌ Você não pode doar um personagem para si mesmo.");
  }

  const charName = args.slice(1).join(" ").trim();
  if (!charName) {
    return message.reply("⚠️ Especifique o nome do personagem que deseja doar.");
  }

  const guildId = message.guildId!;
  const userId = message.author.id;

  const userPacts = await db
    .select({ pact: pacts, entity: entities })
    .from(pacts)
    .innerJoin(entities, eq(pacts.entityId, entities.id))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)));

  const match = userPacts.find((p) => p.entity.name.toLowerCase().includes(charName.toLowerCase()));
  if (!match) {
    return message.reply(`❌ Você não possui **"${charName}"** no seu Panteão.`);
  }

  // Transfere o pacto para o novo dono
  await db
    .update(pacts)
    .set({ userId: targetUser.id })
    .where(eq(pacts.id, match.pact.id));

  return message.reply(
    `🎁 ✨ **${message.author.username}** transferiu o Pacto com **${match.entity.name}** para <@${targetUser.id}>!`
  );
}

/**
 * 6. $note, $alias — Notas e apelidos customizados estilo Mudae
 */
export async function handleCustomizationCommands(
  message: Message,
  commandName: string,
  args: string[]
) {
  const guildId = message.guildId!;
  const userId = message.author.id;

  if (commandName === "note") {
    const raw = args.join(" ").trim();
    const parts = raw.split("$");
    const charName = parts[0]?.trim();
    const noteText = parts[1]?.trim() || "";

    if (!charName) {
      return message.reply("📝 Uso: `$note <personagem> $ <sua anotação aqui>`\nExemplo: `$note Zero Two $ Minha waifu suprema`");
    }

    const userPacts = await db
      .select({ pact: pacts, entity: entities })
      .from(pacts)
      .innerJoin(entities, eq(pacts.entityId, entities.id))
      .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)));

    const match = userPacts.find((p) => p.entity.name.toLowerCase().includes(charName.toLowerCase()));
    if (!match) {
      return message.reply(`❌ Você não possui **"${charName}"** no seu Panteão.`);
    }

    await db.update(pacts).set({ note: noteText }).where(eq(pacts.id, match.pact.id));
    return message.reply(`📝 Nota para **${match.entity.name}** atualizada: *"${noteText || "Nenhuma nota"}"*`);
  }

  if (commandName === "alias" || commandName === "alias2") {
    const raw = args.join(" ").trim();
    const parts = raw.split("$");
    const charName = parts[0]?.trim();
    const aliasText = parts[1]?.trim();

    if (!charName || !aliasText) {
      return message.reply("🏷️ Uso: `$alias <personagem> $ <apelido>`\nExemplo: `$alias Zero Two $ 002`");
    }

    const userPacts = await db
      .select({ pact: pacts, entity: entities })
      .from(pacts)
      .innerJoin(entities, eq(pacts.entityId, entities.id))
      .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)));

    const match = userPacts.find((p) => p.entity.name.toLowerCase().includes(charName.toLowerCase()));
    if (!match) {
      return message.reply(`❌ Você não possui **"${charName}"** no seu Panteão.`);
    }

    await db.update(pacts).set({ alias2: aliasText }).where(eq(pacts.id, match.pact.id));
    return message.reply(`🏷️ Apelido para **${match.entity.name}** definido como: **${aliasText}**!`);
  }
}

/**
 * 7. MODERAÇÃO DIMENSIONAL ($cleanuser, $userdivorce, $thanos)
 */
export async function handleModerationCommands(
  message: Message,
  commandName: string,
  args: string[]
) {
  if (!message.member?.permissions.has("Administrator")) {
    return message.reply("🛡️ Você precisa ser um **Administrador** para executar comandos de moderação do Panteão.");
  }

  const guildId = message.guildId!;

  if (commandName === "userdivorce" || commandName === "cleanuser") {
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply("⚠️ Mencione o usuário que terá o Panteão resetado. Exemplo: `$cleanuser @usuario`");
    }

    const deleted = await db
      .delete(pacts)
      .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, targetUser.id)))
      .returning();

    return message.reply(
      `🧹 Todos os **${deleted.length}** pactos de <@${targetUser.id}> foram liberados de volta ao éter dimensional!`
    );
  }

  if (commandName === "thanos") {
    // Dissolve 50% dos personagens sem chaves de forma aleatória
    const allPacts = await db.select().from(pacts).where(eq(pacts.guildId, guildId));
    const unkeyed = allPacts.filter((p) => p.awakeningKeys === 0);
    const toRemove = unkeyed.filter(() => Math.random() < 0.5);

    for (const p of toRemove) {
      await db.delete(pacts).where(eq(pacts.id, p.id));
    }

    return message.reply(
      `🫰 *Thanos estalou os dedos...* **${toRemove.length}** entidades do servidor foram dissolvidas no éter!`
    );
  }
}
