import { Message, EmbedBuilder } from "discord.js";
import { db } from "../database/index.js";
import { guilds, guildProfiles, users } from "../database/schema.js";
import { eq } from "drizzle-orm";
import { handleSummonCommand } from "../commands/summon.js";
import { handlePantheonCommand } from "../commands/pantheon.js";
import { handleTimersCommand } from "../commands/timers.js";
import {
  handleInfoCommand,
  handleProfileCommand,
  handleDissolveCommand,
  handleDailyCommand,
  handleRelicsCommand,
  handleWishCommand,
  handleTopCommand,
  handleImportCommand,
  handleSuggestCommand,
  handleSuggestionAdminCommands,
} from "../commands/rpgCommands.js";
import {
  handleSettingsCommand,
  handleAdminConfigCommands,
  handleDisableCommand,
  handleFirstMarryCommand,
  handleGiveCommand,
  handleCustomizationCommands,
  handleModerationCommands,
} from "../commands/advancedConfig.js";


// Cache de configurações de guilda em memória para respostas instantâneas
const guildCache = new Map<string, any>();

export async function handleMessage(message: Message) {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;

  // Carrega ou usa o cache da guilda
  let guildData = guildCache.get(guildId);
  if (!guildData) {
    guildData = await db.query.guilds.findFirst({
      where: eq(guilds.id, guildId),
    });

    if (!guildData) {
      try {
        db.insert(guilds)
          .values({
            id: guildId,
            prefix: "$",
            language: "pt-BR",
          })
          .run();
        guildData = { id: guildId, prefix: "$", language: "pt-BR" };
      } catch {
        guildData = { id: guildId, prefix: "$", language: "pt-BR" };
      }
    }
    guildCache.set(guildId, guildData);
  }

  const prefix = guildData.prefix || "$";

  // Se não começa com o prefixo do servidor, ignora
  if (!message.content.startsWith(prefix)) return;

  // Extrai o comando e argumentos
  const rawWithoutPrefix = message.content.slice(prefix.length).trim();
  const args = rawWithoutPrefix.split(/ +/);
  const commandName = args.shift()?.toLowerCase() || "";

  // 1. COMANDOS DE INVOCAÇÃO (Rolls):
  // $w, $wa, $wg, $wc, $wm, $h, $ha, $hg, $hc, $hm, $m, $s, $ma, $mg, $mc, $ar
  if (
    commandName === "w" ||
    commandName === "wa" ||
    commandName === "wg" ||
    commandName === "wc" ||
    commandName === "wm" ||
    commandName === "wx" ||
    commandName === "h" ||
    commandName === "ha" ||
    commandName === "hg" ||
    commandName === "hc" ||
    commandName === "hm" ||
    commandName === "hx" ||
    commandName === "m" ||
    commandName === "mx" ||
    commandName === "s" ||
    commandName === "ma" ||
    commandName === "mg" ||
    commandName === "mc" ||
    commandName === "sa" ||
    commandName === "sg" ||
    commandName === "sc" ||
    commandName === "ar"
  ) {
    return handleSummonCommand(message, commandName, args, guildData);
  }

  // 2. COMANDOS DE PANTEÃO (Coleção / Harém):
  // $pt, $p, $pantheon, $mm, $mymarry
  if (
    commandName === "pt" ||
    commandName === "p" ||
    commandName === "pantheon" ||
    commandName === "mm" ||
    commandName === "mymarry" ||
    commandName.startsWith("pt") ||
    commandName.startsWith("mm")
  ) {
    return handlePantheonCommand(message, commandName, args, guildData);
  }

  // 3. COMANDOS DE TEMPORIZADORES:
  // $tu, $timersup, $timers, $mu, $ru, $ku, $rollsleft
  if (
    commandName === "tu" ||
    commandName === "timersup" ||
    commandName === "timers" ||
    commandName === "mu" ||
    commandName === "marryup" ||
    commandName === "ru" ||
    commandName === "rollsup" ||
    commandName === "ku" ||
    commandName === "kakeraup" ||
    commandName === "rollsleft"
  ) {
    return handleTimersCommand(message, guildData, commandName);
  }

  // 4. ENCICLOPÉDIA / PESQUISA DE PERSONAGEM ($im, $info, $infomarry)
  if (commandName === "im" || commandName === "info" || commandName === "infomarry" || commandName === "ima") {
    return handleInfoCommand(message, args);
  }

  // 5. PERFIL DO JOGADOR ($pr, $profile)
  if (commandName === "pr" || commandName === "profile" || commandName === "perfil") {
    return handleProfileCommand(message);
  }

  // 6. DISSOLVER PACTO / DIVÓRCIO ($dissolve, $divorce)
  if (commandName === "dissolve" || commandName === "divorce" || commandName === "divorcio") {
    return handleDissolveCommand(message, args);
  }

  // 7. BÔNUS DIÁRIO ($daily, $dk, $dailykakera, $rolls)
  if (commandName === "daily" || commandName === "dk" || commandName === "dailykakera" || commandName === "diario" || commandName === "rolls") {
    return handleDailyCommand(message);
  }

  // 8. RELÍQUIAS / EMBLEMAS ($k, $kakera, $relics, $badge)
  if (commandName === "k" || commandName === "kakera" || commandName === "relics" || commandName === "badge" || commandName === "reliquias") {
    return handleRelicsCommand(message, args);
  }

  // 9. LISTA DE DESEJOS ($wish, $wl, $wishlist, $sw, $starwish)
  if (
    commandName === "wish" ||
    commandName === "wl" ||
    commandName === "wishlist" ||
    commandName === "sw" ||
    commandName === "starwish"
  ) {
    return handleWishCommand(message, commandName, args);
  }

  // 10. RANKINGS ($top, $topserv, $ts)
  if (commandName === "top" || commandName === "topserv" || commandName === "ts") {
    return handleTopCommand(message, commandName);
  }

  // 11. IMPORTADOR RESTRITO (Criador/Staff & VIPs) & FILA DE SUGESTÕES ($suggest)
  if (commandName === "import" || commandName === "add" || commandName === "importar") {
    return handleImportCommand(message, args);
  }

  if (commandName === "suggest" || commandName === "sugerir") {
    return handleSuggestCommand(message, args);
  }

  if (
    commandName === "suggestlist" ||
    commandName === "sugestoes" ||
    commandName === "approvesuggest" ||
    commandName === "aprovar"
  ) {
    return handleSuggestionAdminCommands(message, commandName, args);
  }


  // 12. CONFIGURAÇÕES DO SERVIDOR ($settings, $setrolls, $settimer, $setclaim, $gamemode, $prefix)
  if (commandName === "settings" || commandName === "serversettings" || commandName === "config") {
    return handleSettingsCommand(message, guildData);
  }

  if (
    commandName === "setrolls" ||
    commandName === "settimer" ||
    commandName === "setclaim" ||
    commandName === "gamemode" ||
    commandName === "prefix" ||
    commandName === "prefixo"
  ) {
    await handleAdminConfigCommands(message, commandName, args, guildData);
    guildCache.delete(guildId);
    return;
  }

  // 13. DESATIVAÇÃO DE SÉRIES ($disable, $antidisable, $disablelist)
  if (
    commandName === "disable" ||
    commandName === "antidisable" ||
    commandName === "disablelist" ||
    commandName === "dl" ||
    commandName === "ad"
  ) {
    return handleDisableCommand(message, commandName, args);
  }

  // 14. LÍDER DO PANTEÃO ($firstmarry / $fm)
  if (commandName === "firstmarry" || commandName === "fm") {
    return handleFirstMarryCommand(message, args);
  }

  // 15. PRESENTEAR ENTIDADE ($give)
  if (commandName === "give" || commandName === "dar") {
    return handleGiveCommand(message, args);
  }

  // 16. PERSONALIZAÇÃO ($note, $alias, $alias2)
  if (commandName === "note" || commandName === "nota" || commandName === "alias" || commandName === "alias2") {
    return handleCustomizationCommands(message, commandName, args);
  }

  // 17. MODERAÇÃO DIMENSIONAL ($cleanuser, $userdivorce, $thanos)
  if (commandName === "cleanuser" || commandName === "userdivorce" || commandName === "thanos") {
    return handleModerationCommands(message, commandName, args);
  }

  // 18. GESTÃO DE VIPS ($setvip @user <tier>)
  if (commandName === "setvip") {
    if (!message.member?.permissions.has("Administrator")) {
      return message.reply("🛡️ Apenas administradores podem definir o status VIP de membros.");
    }
    const targetUser = message.mentions.users.first();
    const tierNum = parseInt(args[1], 10);
    if (!targetUser || isNaN(tierNum)) {
      return message.reply("⚠️ Uso: `$setvip @usuario <tier>` (Tiers: `0` = Normal, `1` = Booster, `2` = VIP Nobre, `3` = Divindade)");
    }

    await db
      .insert(users)
      .values({
        id: targetUser.id,
        username: targetUser.username,
        isVip: tierNum > 0,
        vipTier: tierNum,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { isVip: tierNum > 0, vipTier: tierNum },
      });

    return message.reply(`👑 Status VIP de <@${targetUser.id}> atualizado para **Tier ${tierNum}** com sucesso!`);
  }

  // 19. COMANDO EXCLUSIVO DE TESTES PARA O CRIADOR ($adminreset / $godmode / $resetme)
  if (commandName === "adminreset" || commandName === "godmode" || commandName === "resetme") {
    if (!message.member?.permissions.has("Administrator")) {
      return message.reply("❌ Apenas administradores do bot podem usar este comando de teste.");
    }
    const profileId = `${guildId}:${message.author.id}`;
    const baseRolls = guildData?.baseRolls || 10;
    const amount = args[0] ? parseInt(args[0], 10) : baseRolls;
    const rollsToSet = isNaN(amount) ? baseRolls : amount;

    await db
      .update(guildProfiles)
      .set({
        rollsRemaining: rollsToSet,
        pactsAvailable: 1,
        stackedRolls: 50,
      })
      .where(eq(guildProfiles.id, profileId));

    return message.reply(
      `⚡ **Modo de Testes do Criador:** Seus rolls foram restaurados para **${rollsToSet}** e você recebeu **+50 Rolls Empilhados** para testes!`
    );
  }



  // 18. COMANDO DE IDIOMA ($lang <pt-br | en | es>)
  if (commandName === "lang" || commandName === "idioma") {
    const newLang = args[0]?.toLowerCase();
    const valid = ["pt-br", "en", "es"];
    if (!valid.includes(newLang)) {
      return message.reply("🌐 Idiomas suportados: `pt-br`, `en`, `es`.\nUso: `$lang pt-br`");
    }

    const langCode = newLang === "en" ? "en-US" : newLang === "es" ? "es-ES" : "pt-BR";
    await db.update(guilds).set({ language: langCode }).where(eq(guilds.id, guildId));
    guildCache.delete(guildId);
    return message.reply(`✅ Idioma do servidor atualizado para **${langCode}**!`);
  }

  // 19. CENTRAL DE AJUDA ($help / $ajuda)
  if (commandName === "help" || commandName === "ajuda" || commandName === "comandos") {
    const embed = new EmbedBuilder()
      .setTitle("🌌 Central Dimensional — Comandos do Arqon")
      .setColor("#5865F2")
      .addFields(
        {
          name: "🎲 Roleta de Invocação (Rolls)",
          value:
            "`$wa` / `$wg` / `$w` — Invocar Waifus (Anime, Games, Geral)\n" +
            "`$ha` / `$hg` / `$h` — Invocar Husbandos (Anime, Games, Geral)\n" +
            "`$ma` / `$mg` / `$m` — Invocar Ambos (Anime, Games, Geral)\n" +
            "`$ar` — Invocar Armas Lendárias & Artefatos Equipáveis",
          inline: false,
        },
        {
          name: "🏛️ Panteão & Coleção (Harém)",
          value:
            "`$pt` (ou `$mm`) — Ver seu Panteão (suporta flags: `$ptk=`, `$ptw`, `$pth`, `$pty`)\n" +
            "`$fm <nome>` — Definir o Líder supremo do seu Panteão\n" +
            "`$give @user <nome>` — Presentear um personagem a outro jogador\n" +
            "`$note <nome> $ <texto>` — Anotar uma mensagem personalizada na carta\n" +
            "`$pr` (ou `$profile`) — Ver seu Perfil Dimensional, Éter e Relíquias\n" +
            "`$im <nome>` — Inspecionar a carta e atributos de qualquer personagem\n" +
            "`$divorce <nome>` (ou `$dissolve`) — Dissolver pacto em troca de Éter",
          inline: false,
        },
        {
          name: "💠 Economia de Éter & Desejos",
          value:
            "`$daily` (ou `$dk`) — Resgatar Éter diário + recarregar rolls!\n" +
            "`$k` (ou `$relics`) — Ver e evoluir suas Relíquias (Bronze a Esmeralda)\n" +
            "`$wish <nome>` / `$sw <nome>` — Adicionar personagem à Lista de Desejos (`$wl`)\n" +
            "`$disable <série>` / `$dl` — Desativar animes que não deseja nas rolagens\n" +
            "`$tu` — Ver todos os seus temporizadores de Pacto e Rolls",
          inline: false,
        },
        {
          name: "⚙️ Servidor & Moderação (Staff)",
          value:
            "`$settings` — Visualizar painel completo do servidor\n" +
            "`$setrolls <5-50>` — Alterar limite de rolagens por hora\n" +
            "`$settimer <minutos>` — Alterar tempo de recarga de pacto\n" +
            "`$cleanuser @user` / `$thanos` — Limpar usuários inativos ou purgar 50%",
          inline: false,
        }
      )
      .setFooter({ text: "Arqon RPG Dimensional • Prefixo: $" });

    return message.reply({ embeds: [embed] });
  }
}

