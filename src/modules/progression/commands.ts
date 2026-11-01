import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { z } from "zod";
import type { AnyCommand, CommandContext, ComponentHandler } from "../../core/contracts.js";
import { claimDaily, credit } from "../economy/service.js";
import { dailyEmbed } from "../economy/views.js";
import { parseUserId } from "../economy/commands.js";
import { emoji } from "../../ui/emojis.js";
import { formatNumber } from "../../ui/format.js";
import { UserError } from "../../lib/errors.js";
import {
  activateFreeClaim,
  activateResetTimer,
  buildTowerFloor,
  calculateCosmicFate,
  claimTutorialRewards,
  destroyTower,
  doubleBlackjack,
  formatCards,
  generateAetherBeam,
  generateQuizQuestion,
  get42BallAnswer,
  getRandomQuote,
  getTowerState,
  hitBlackjack,
  LOOTBOX_COST,
  openLootbox,
  pickTeaChallenge,
  renderHpBar,
  runArenaBattle,
  runCoinflip,
  spinSlotMachine,
  standBlackjack,
  startBlackjack,
  TOWER_PERKS,
  transferAether,
  type BlackjackGame,
  type CoinflipResult,
  type SlotResult,
} from "./service.js";

export const PROGRESSION_NS = "prg";

function slashBase(name: string, ptDesc: string, enDesc: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(ptDesc)
    .setDescriptionLocalizations({ "en-US": enDesc });
}

function mapProgressionError(err: unknown, prefix: string): string | null {
  if (!(err instanceof UserError)) return null;
  switch (err.key) {
    case "progression.no_freeclaim":
      return `⛔ Você não possui cargas de **Pacto Extra (\`${prefix}fc\`)** disponíveis. Complete o \`${prefix}tuto\` ou abra Caixas Astrais (\`${prefix}kl\`) para conseguir!`;
    case "progression.rt_cooldown":
      return `⏳ Sua habilidade **\`${prefix}rt\`** ainda está em recarga (20h entre usos).`;
    case "progression.rt_requires_emerald":
      return `💎 Você precisa ter a **Relíquia de Esmeralda (Nível 1+)** em \`${prefix}relics\` para usar \`${prefix}rt\`.`;
    case "progression.tower_max_level":
      return `🏛️ Você já construiu todos os **12 andares** do Obelisco Dimensional!`;
    case "progression.tower_invalid_perk":
      return `⚠️ Escolha um andar válido de **1 a 12** (ex.: \`${prefix}build 1\`).`;
    case "progression.tower_perk_already_built":
      return `⚠️ Este andar já foi construído na sua Torre de Éter! Escolha outro número de 1 a 12.`;
    case "progression.insufficient_aether":
      return `⛔ Saldo de Éter insuficiente para realizar esta ação.`;
    case "progression.tower_empty":
      return `🏛️ Sua Torre de Éter ainda está no nível 0 — não há andares para demolir.`;
    case "progression.cannot_give_self":
      return `⚠️ Você não pode transferir Éter para si mesmo.`;
    case "progression.invalid_give_amount":
      return `⚠️ Informe um usuário e uma quantia válida entre **10** e **1.000.000** (ex.: \`${prefix}givekakera @usuario 500\`).`;
    case "progression.game_expired":
      return `⏳ Esta sessão de jogo expirou. Inicie uma nova rodada!`;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* 1. $tuto / $skiptuto / $fc / $rt                                   */
/* ------------------------------------------------------------------ */

export const tutoCommand: AnyCommand = {
  name: "tuto",
  aliases: ["tutorial"],
  category: "economy",
  descriptionKey: "help.commands.tuto",
  cooldownMs: 3000,
  slash: () => slashBase("tuto", "Inicia o tutorial interativo e resgata bônus iniciais.", "Starts the interactive tutorial and claims starter bonuses."),
  async execute(ctx: CommandContext) {
    const p = ctx.guildConfig.prefix;
    const reward = await claimTutorialRewards(ctx.guild.id, ctx.user.id, ctx.user.username);
    const aetherIcon = emoji("aether");

    const statusLine = reward.alreadyClaimed
      ? `✅ **Bônus de Iniciação já resgatado!** *(Cargas de \`${p}fc\` disponíveis: **${reward.freeClaimsAvailable}**)*`
      : `🎁 **RECOMPENSA DE INICIAÇÃO CREDITADA AGORA:**\n` +
        `▸ **+${formatNumber(reward.aetherGranted, ctx.locale)}** ${aetherIcon} Éter\n` +
        `▸ **+${reward.rollsGranted} Invocações Extras** (\`${p}ru\`)\n` +
        `▸ **+1 Carga de Pacto Extra (\`${p}fc\` / \`${p}freeclaim\`)** — *Permite casar/firmar pacto uma segunda vez seguida mesmo em cooldown!*`;

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("🎓 Guia de Iniciação Dimensional — Kogu")
      .setDescription(
        `${statusLine}\n\n` +
          `### 📜 Como Jogar em 5 Passos:\n` +
          `**1. Invocação de Cartas:** Digite \`${p}w\` (Waifus), \`${p}h\` (Husbands), \`${p}wg\` (Games) ou \`${p}wc\` (Cinema/Doramas/Idols). Clique no botão de Pacto antes de 120s!\n` +
          `**2. Segundo Pacto Grátis (\`${p}fc\`):** Já casou nesta janela e tirou outra carta incrível? Digite \`${p}fc\` para zerar seu tempo de Pacto e pegar outra carta na hora!\n` +
          `**3. Coleção & Trocas:** Veja seu Panteão em \`${p}pt\` (\`${p}mm\`) e negocie com outros jogadores em \`${p}trade\`.\n` +
          `**4. Evolução de Éter:** Invista seu Éter em \`${p}relics\` (\`${p}k\`), construa sua Torre em \`${p}ktower\` e abra Caixas Astrais em \`${p}kl\`.\n` +
          `**5. Jogos & Combate:** Ganhe Éter jogando \`${p}arena\`, \`${p}slot\`, \`${p}blacktea\` e \`${p}quiz\`!`
      )
      .setFooter({ text: `Saldo atual: ${formatNumber(reward.balance, ctx.locale)} Éter · Use ${p}fc quando precisar de um Pacto extra!` });

    await ctx.reply({ embeds: [embed] });
  },
};

export const skipTutoCommand: AnyCommand = {
  name: "skiptuto",
  aliases: ["pulartuto"],
  category: "economy",
  descriptionKey: "help.commands.skiptuto",
  cooldownMs: 3000,
  async execute(ctx: CommandContext) {
    await tutoCommand.execute(ctx);
  },
};

export const freeClaimCommand: AnyCommand = {
  name: "freeclaim",
  aliases: ["fc"],
  category: "economy",
  descriptionKey: "help.commands.freeclaim",
  cooldownMs: 3000,
  slash: () => slashBase("freeclaim", "Usa sua carga de Pacto Extra do tutorial para zerar o cooldown de Pacto.", "Uses your tutorial Free Claim charge to reset your Pact cooldown."),
  async execute(ctx: CommandContext) {
    const p = ctx.guildConfig.prefix;
    try {
      const res = await activateFreeClaim(ctx.guild.id, ctx.user.id, ctx.user.username);
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("⚡ Pacto Extra Ativado ($freeclaim)!")
        .setDescription(
          `Seu tempo de espera de Pacto (\`${p}mu\`) foi **zerado imediatamente**!\n` +
            `Você já pode firmar um novo Pacto na sua próxima invocação.\n\n` +
            `🔹 Cargas de \`${p}fc\` restantes: **${res.remainingCharges}**`
        );
      await ctx.reply({ embeds: [embed] });
    } catch (err) {
      const msg = mapProgressionError(err, p);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

export const resetTimerCommand: AnyCommand = {
  name: "rt",
  aliases: ["resetclaimtimer"],
  category: "economy",
  descriptionKey: "help.commands.rt",
  cooldownMs: 3000,
  slash: () => slashBase("rt", "Zera o cooldown de Pacto usando a Relíquia de Esmeralda (recarga: 20h).", "Resets Pact cooldown using the Emerald Relic (20h cooldown)."),
  async execute(ctx: CommandContext) {
    const p = ctx.guildConfig.prefix;
    try {
      const res = await activateResetTimer(ctx.guild.id, ctx.user.id, ctx.user.username);
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle("💎 Ressonância Esmeralda Ativada ($rt)!")
        .setDescription(
          `Seu cooldown de Pacto (\`${p}mu\`) foi **zerado instantaneamente**!\n` +
            `⏳ Próxima recarga do \`${p}rt\` em **${res.nextReadyInHours}h**.`
        );
      await ctx.reply({ embeds: [embed] });
    } catch (err) {
      const msg = mapProgressionError(err, p);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

/* ------------------------------------------------------------------ */
/* 2. Torre de Eter ($ktower / $build / $destroy)                     */
/* ------------------------------------------------------------------ */

function renderTowerEmbed(
  state: Awaited<ReturnType<typeof getTowerState>>,
  prefix: string,
  locale: string
): EmbedBuilder {
  const aetherIcon = emoji("aether");
  const perksLines = TOWER_PERKS.map((perk) => {
    const built = state.floors.includes(perk.id);
    const mark = built ? "✅" : `**[${perk.id}]**`;
    return `${mark} **${perk.namePt}** — ${perk.descPt}`;
  }).join("\n");

  const nextLine =
    state.level >= 12
      ? `🏆 **Torre Completa (12/12 Andares)!**`
      : `Próximo andar custa **${formatNumber(state.nextCost, locale)}** ${aetherIcon}`;

  return new EmbedBuilder()
    .setColor(0x06b6d4)
    .setTitle("🗼 Obelisco Dimensional — Torre de Éter ($ktower)")
    .setDescription(
      `Invista seu ${aetherIcon} **Éter** para erguer os **12 andares** da Torre e desbloquear bônus permanentes:\n` +
        `• Escolha uma bênção diferente a cada andar construído\n` +
        `• Você pode demolir a torre e receber **100% de reembolso** com \`${prefix}destroy\`\n\n` +
        `📊 **Seu Nível Atual:** \`${state.level} / 12\`\n` +
        `💎 **Custo do Próximo Nível:** ${nextLine}\n` +
        `💰 **Seu Saldo:** **${formatNumber(state.balance, locale)}** ${aetherIcon}\n\n` +
        `Construa usando \`${prefix}build <número>\` ou pelos botões abaixo:\n\n` +
        perksLines
    );
}

function buildTowerButtons(userId: string, level: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PROGRESSION_NS}:tbuild:${userId}`)
      .setLabel("🔼 Construir Próximo Andar")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(level >= 12),
    new ButtonBuilder()
      .setCustomId(`${PROGRESSION_NS}:tdestroy:${userId}`)
      .setLabel("💥 Demolir (100% Reembolso)")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(level === 0)
  );
}

export const ktowerCommand: AnyCommand = {
  name: "ktower",
  aliases: ["tower", "kakeratower", "torre"],
  category: "economy",
  descriptionKey: "help.commands.ktower",
  cooldownMs: 3000,
  slash: () => slashBase("tower", "Exibe a Torre de Éter (12 andares de bônus passivos).", "Shows the Aether Tower (12 floors of passive perks)."),
  async execute(ctx: CommandContext) {
    const state = await getTowerState(ctx.guild.id, ctx.user.id, ctx.user.username);
    const embed = renderTowerEmbed(state, ctx.guildConfig.prefix, ctx.locale);
    const row = buildTowerButtons(ctx.user.id, state.level);
    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

const buildArgs = z.object({ perk: z.coerce.number().int().min(1).max(12).optional() });

export const buildCommand: AnyCommand = {
  name: "build",
  aliases: ["construir"],
  category: "economy",
  descriptionKey: "help.commands.build",
  args: buildArgs,
  parseArgs: (tokens) => ({ perk: tokens[0] ? Number(tokens[0]) : undefined }),
  cooldownMs: 3000,
  async execute(ctx: CommandContext) {
    const p = ctx.guildConfig.prefix;
    const rawPerk = (ctx.args as { perk?: number } | undefined)?.perk;
    try {
      const res = await buildTowerFloor(ctx.guild.id, ctx.user.id, rawPerk, ctx.user.username);
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle(`🏛️ Andar ${res.level}/12 Construído!`)
        .setDescription(
          `Você desbloqueou **[${res.builtPerk.id}] ${res.builtPerk.namePt}**:\n` +
            `✨ *${res.builtPerk.descPt}*\n\n` +
            `💰 Saldo restante: **${formatNumber(res.balance, ctx.locale)}** ${emoji("aether")}`
        );
      await ctx.reply({ embeds: [embed] });
    } catch (err) {
      const msg = mapProgressionError(err, p);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

export const destroyCommand: AnyCommand = {
  name: "destroy",
  aliases: ["demolir", "towerdestroy"],
  category: "economy",
  descriptionKey: "help.commands.destroy",
  cooldownMs: 3000,
  async execute(ctx: CommandContext) {
    const p = ctx.guildConfig.prefix;
    try {
      const res = await destroyTower(ctx.guild.id, ctx.user.id, ctx.user.username);
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("💥 Torre Demolida & Éter Reembolsado!")
        .setDescription(
          `Todos os andares foram desmontados e você recebeu **+${formatNumber(res.refunded, ctx.locale)}** ${emoji("aether")} de volta!\n` +
            `💰 Novo saldo: **${formatNumber(res.balance, ctx.locale)}** ${emoji("aether")}`
        );
      await ctx.reply({ embeds: [embed] });
    } catch (err) {
      const msg = mapProgressionError(err, p);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

/* ------------------------------------------------------------------ */
/* 3. Caixas Astrais ($kl / $infokl) & Doacao ($givekakera) & Keys    */
/* ------------------------------------------------------------------ */

export const lootboxCommand: AnyCommand = {
  name: "kl",
  aliases: ["lootbox", "infokl", "caixa"],
  category: "economy",
  descriptionKey: "help.commands.kl",
  cooldownMs: 3000,
  slash: () => slashBase("lootbox", "Abre uma Caixa Astral por 1.000 Éter em busca de rolls, chaves e bônus.", "Opens an Astral Lootbox for 1,000 Aether."),
  async execute(ctx: CommandContext) {
    const p = ctx.guildConfig.prefix;
    if (ctx.invokedAs.toLowerCase() === "infokl") {
      const info = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle("📦 Caixas Astrais — Recompensas ($kl)")
        .setDescription(
          `Cada **Caixa Astral (\`${p}kl\`)** custa **${formatNumber(LOOTBOX_COST, ctx.locale)}** ${emoji("aether")} e concede uma das recompensas abaixo:\n\n` +
            `• 🎲 **35% — Recarga de Invocações:** \`+3 a +5\` Rolls empilhados imediatos\n` +
            `• 💠 **30% — Tesouro de Éter:** \`1.200 a 2.300\` Éter\n` +
            `• 🗝️ **20% — Selo de Despertar:** \`+1 Key\` direto em um personagem do seu Panteão\n` +
            `• ⚡ **15% — Carga de Pacto Extra (\`${p}fc\`):** Permite firmar um segundo pacto sem esperar cooldown!\n\n` +
            `Digite **\`${p}kl\`** para abrir uma caixa agora!`
        );
      await ctx.reply({ embeds: [info] });
      return;
    }

    try {
      const reward = await openLootbox(ctx.guild.id, ctx.user.id, ctx.user.username);
      let prizeLine = "";
      if (reward.kind === "rolls") {
        prizeLine = `🎲 **+${reward.amount} Invocações Extras** adicionadas ao seu estoque (\`${p}ru\`)!`;
      } else if (reward.kind === "aether") {
        prizeLine = `💠 **+${formatNumber(reward.amount, ctx.locale)}** ${emoji("aether")} **Éter Astral**!`;
      } else if (reward.kind === "key") {
        prizeLine = `🗝️ **+1 Selo de Despertar** concedido para **${reward.entityName}**!`;
      } else {
        prizeLine = `⚡ **+1 Carga de Pacto Extra (\`${p}fc\`)** desbloqueada!`;
      }

      const embed = new EmbedBuilder()
        .setColor(0xd946ef)
        .setTitle("📦 Caixa Astral Aberta!")
        .setDescription(
          `Você investiu **${formatNumber(LOOTBOX_COST, ctx.locale)}** ${emoji("aether")} e obteve:\n\n` +
            `### ${prizeLine}\n\n` +
            `💰 Saldo atual: **${formatNumber(reward.newBalance, ctx.locale)}** ${emoji("aether")}`
        );
      await ctx.reply({ embeds: [embed] });
    } catch (err) {
      const msg = mapProgressionError(err, p);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

const giveArgs = z.object({
  target: z.string().optional(),
  amount: z.coerce.number().int().optional(),
});

export const giveKakeraCommand: AnyCommand = {
  name: "givekakera",
  aliases: ["giveether", "doareter", "gk"],
  category: "economy",
  descriptionKey: "help.commands.givekakera",
  args: giveArgs,
  parseArgs: (tokens) => ({ target: tokens[0], amount: tokens[1] ? Number(tokens[1]) : undefined }),
  cooldownMs: 3000,
  slash: () =>
    slashBase("giveether", "Transfere Éter para outro jogador do servidor.", "Transfers Aether to another player in the server.")
      .addUserOption((o) => o.setName("user").setDescription("Jogador destinatário").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Quantia de Éter (mín. 10)").setMinValue(10).setRequired(true)),
  slashArgs: (i) => ({
    target: i.options.getUser("user", true).id,
    amount: i.options.getInteger("amount", true),
  }),
  async execute(ctx: CommandContext) {
    const p = ctx.guildConfig.prefix;
    const args = ctx.args as { target?: string; amount?: number } | undefined;
    const targetId = parseUserId(args?.target);
    const amount = args?.amount ?? 0;

    if (!targetId || !amount) {
      await ctx.reply({
        content: `⚠️ Uso: \`${p}givekakera @usuario <quantia>\` (mínimo 10 Éter).`,
        ephemeral: true,
      });
      return;
    }

    try {
      const res = await transferAether(ctx.guild.id, ctx.user.id, targetId, amount);
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("💸 Transferência de Éter Concluída!")
        .setDescription(
          `<@${ctx.user.id}> transferiu **${formatNumber(amount, ctx.locale)}** ${emoji("aether")} para <@${targetId}>!\n\n` +
            `💰 Seu novo saldo: **${formatNumber(res.senderBalance, ctx.locale)}** ${emoji("aether")}`
        );
      await ctx.reply({
        embeds: [embed],
        allowedMentions: { parse: [], users: [targetId] },
      });
    } catch (err) {
      const msg = mapProgressionError(err, p);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

export const infoKeysCommand: AnyCommand = {
  name: "infokeys",
  aliases: ["keysinfo", "selos", "infosphere"],
  category: "economy",
  descriptionKey: "help.commands.infokeys",
  cooldownMs: 3000,
  async execute(ctx: CommandContext) {
    const keyIcon = emoji("key");
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`${keyIcon} Selos de Despertar & Evolução ($infokeys)`)
      .setDescription(
        `Sempre que você invoca um personagem que **já pertence ao seu Panteão**, ele recebe **+1 Selo de Despertar (${keyIcon})**!\n\n` +
          `### 🏆 Marcos de Poder:\n` +
          `• **1 a 2 Selos (Bronze):** Aumenta o valor de Éter e atributos de combate em **+10%**.\n` +
          `• **3 a 5 Selos (Prata):** Aumenta o valor de Éter em **+20% a +30%** e fortalece a carta na \`$arena\`.\n` +
          `• **6 a 9 Selos (Ouro):** Bônus de Éter de **+50% a +60%** e destaque dourado.\n` +
          `• **10+ Selos (Alma Gêmea / Soulmate):** +5% de Éter por cada Selo adicional sem limites!`
      );
    await ctx.reply({ embeds: [embed] });
  },
};

/* ------------------------------------------------------------------ */
/* 4. Jogos & Combate ($arena, $slot, $blacktea, $quiz, $invite)      */
/* ------------------------------------------------------------------ */

const arenaArgs = z.object({ opponent: z.string().optional() });

export const arenaCommand: AnyCommand = {
  name: "arena",
  aliases: ["duel", "duelo", "batalha", "mmf"],
  category: "economy",
  descriptionKey: "help.commands.arena",
  args: arenaArgs,
  parseArgs: (tokens) => ({ opponent: tokens[0] }),
  cooldownMs: 5000,
  slash: () =>
    slashBase("arena", "Inicia um duelo RPG na Arena Dimensional com sua carta mais forte.", "Starts an RPG duel in the Dimensional Arena with your strongest card.")
      .addUserOption((o) => o.setName("opponent").setDescription("Oponente (opcional: sem escolher enfrenta o Guardião)").setRequired(false)),
  slashArgs: (i) => ({ opponent: i.options.getUser("opponent")?.id }),
  async execute(ctx: CommandContext) {
    const rawOpp = (ctx.args as { opponent?: string } | undefined)?.opponent;
    const oppId = parseUserId(rawOpp);
    const battle = await runArenaBattle(ctx.guild.id, ctx.user.id, oppId);

    const oppLabel = oppId ? `<@${oppId}>` : "🛡️ Guardião do Obelisco";
    const won = battle.winnerId === ctx.user.id;
    const winLabel = battle.winnerId === "guardian" ? "🛡️ Guardião do Obelisco" : `<@${battle.winnerId}>`;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:arena_again:${ctx.user.id}:${oppId ?? "none"}`)
        .setLabel("⚔️ Lutar Novamente")
        .setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
      .setColor(won ? 0x22c55e : 0xef4444)
      .setTitle(`⚔️ Arena Dimensional — ${won ? "Vitória Épica!" : "Derrota no Combate!"}`)
      .setDescription(
        `### ⚔️ Confronto de Campeões\n` +
          `🔹 **<@${ctx.user.id}>** convocou **${battle.fighterA.cardName}**\n` +
          `${renderHpBar(battle.finalHpA, battle.fighterA.hp)} *(ATK ${battle.fighterA.atk} · DEF ${battle.fighterA.def} · SPD ${battle.fighterA.spd})*\n\n` +
          `🔸 **${oppLabel}** convocou **${battle.fighterB.cardName}**\n` +
          `${renderHpBar(battle.finalHpB, battle.fighterB.hp)} *(ATK ${battle.fighterB.atk} · DEF ${battle.fighterB.def} · SPD ${battle.fighterB.spd})*\n\n` +
          `📜 **Relatório do Combate:**\n` +
          battle.log.map((l) => `▸ ${l}`).join("\n") +
          `\n\n` +
          `🏆 **Vencedor:** ${winLabel} com **${battle.winnerCard}**!\n` +
          (won
            ? `🎁 **Recompensa:** **+${formatNumber(battle.rewardAether, ctx.locale)}** ${emoji("aether")} *(Lucro: **+${formatNumber(battle.netProfit, ctx.locale)}**)*`
            : `💀 **Derrota!** Seu combatente foi nocauteado. Você perdeu a taxa de desafio de **-${battle.fee}** ${emoji("aether")}.`)
      );

    if (battle.fighterA.imageUrl) {
      embed.setThumbnail(battle.fighterA.imageUrl);
    }

    await ctx.reply({
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [], users: oppId ? [oppId] : [] },
    });
  },
};

export function renderSlotEmbed(res: SlotResult, locale: string = "pt-BR"): EmbedBuilder {
  const [r1, r2, r3] = res.reels;
  const embed = new EmbedBuilder();

  if (res.won) {
    const headline = res.isJackpot
      ? `🎉 **JACKPOT DIMENSIONAL! TRINCA PERFEITA!**`
      : `✨ **PAR ENCONTRADO! FAMILIAR CAPTURADO!**`;

    embed
      .setColor(res.isJackpot ? 0xfacc15 : 0x22c55e)
      .setTitle(res.isJackpot ? "🎰 JACKPOT DIMENSIONAL! 🌟" : "🎰 Oráculo de Familiares — Captura com Sucesso!")
      .setDescription(
        `### ╔═══════════════════╗\n` +
          `### ║   ${r1.emoji}   │   ${r2.emoji}   │   ${r3.emoji}   ║\n` +
          `### ╚═══════════════════╝\n\n` +
          `${headline}\n` +
          `🐾 **Criatura:** **${res.capturedName}**\n` +
          `💠 **Prêmio Coletado:** **+${formatNumber(res.aetherReward, locale)}** ${emoji("aether")} *(Lucro Líquido: **+${formatNumber(res.netProfit, locale)}**)*\n` +
          `💰 **Seu Saldo:** **${formatNumber(res.newBalance, locale)}** ${emoji("aether")}\n\n` +
          `*Multiplicadores: Trinca = Jackpot (x3.5+) · Par = Familiar (x0.7+)*`
      );
  } else if (res.isNearMiss) {
    embed
      .setColor(0xf97316)
      .setTitle("🎰 Oráculo de Familiares — QUASE UM JACKPOT! 👀")
      .setDescription(
        `### ╔═══════════════════╗\n` +
          `### ║   ${r1.emoji}   │   ${r2.emoji}   │   ${r3.emoji}   ║\n` +
          `### ╚═══════════════════╝\n\n` +
          `👀 **POR UM TRIZ!** Faltou apenas 1 **${res.nearMissSymbol}** para o Super Jackpot!\n` +
          `O terceiro cilindro escapou no último segundo.\n` +
          `Você perdeu **-${formatNumber(res.cost, locale)}** ${emoji("aether")} nesta rodada.\n\n` +
          `💰 **Seu Saldo Atual:** **${formatNumber(res.newBalance, locale)}** ${emoji("aether")}\n\n` +
          `🔥 *Os astros estão quase alinhados! Gire novamente para cravar a trinca!*`
      );
  } else {
    embed
      .setColor(0xef4444)
      .setTitle("🎰 Oráculo de Familiares — Nenhuma Combinação!")
      .setDescription(
        `### ╔═══════════════════╗\n` +
          `### ║   ${r1.emoji}   │   ${r2.emoji}   │   ${r3.emoji}   ║\n` +
          `### ╚═══════════════════╝\n\n` +
          `💀 **NENHUM PAR ENCONTRADO!**\n` +
          `As energias astrais se dissiparam e nenhuma criatura atendeu ao chamado.\n` +
          `Você perdeu **-${formatNumber(res.cost, locale)}** ${emoji("aether")} nesta rodada!\n\n` +
          `💰 **Seu Saldo Atual:** **${formatNumber(res.newBalance, locale)}** ${emoji("aether")}\n\n` +
          `*Tente novamente para alinhar os astros e capturar Familiares Raros!*`
      );
  }
  return embed;
}

export function buildSlotRow(userId: string, bet: number, currentBalance?: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  const canReplaySame = currentBalance === undefined || currentBalance >= bet;
  const canDouble = currentBalance === undefined || currentBalance >= bet * 2;

  if (canReplaySame) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:slot_spin:${userId}:${bet}`)
        .setLabel(`🎰 Girar Novamente (${formatNumber(bet, "pt-BR")} Éter)`)
        .setStyle(ButtonStyle.Primary)
    );
    if (canDouble && bet * 2 <= 10000) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:slot_spin:${userId}:${Math.min(10000, bet * 2)}`)
          .setLabel(`💰 Dobrar (${formatNumber(Math.min(10000, bet * 2), "pt-BR")} Éter)`)
          .setStyle(ButtonStyle.Success)
      );
    }
  } else if (currentBalance !== undefined && currentBalance >= 10) {
    const availableBet = Math.min(bet, currentBalance);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:slot_spin:${userId}:${availableBet}`)
        .setLabel(`🎰 Girar Tudo (${formatNumber(availableBet, "pt-BR")} Éter)`)
        .setStyle(ButtonStyle.Danger)
    );
  }

  if (bet > 50 && (currentBalance === undefined || currentBalance >= 50)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:slot_spin:${userId}:50`)
        .setLabel("🪙 Mínima (50 Éter)")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (currentBalance !== undefined && currentBalance < 10) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:eco_daily:${userId}`)
        .setLabel("🎁 Resgatar Diário ($daily)")
        .setStyle(ButtonStyle.Success)
    );
  }

  return row;
}

const slotArgs = z.object({
  bet: z.number().int().min(10).max(10000).default(50),
});

export const slotCommand: AnyCommand = {
  name: "slot",
  aliases: ["pokemon", "pokeslot", "cassino", "familiar", "pokedex"],
  category: "economy",
  descriptionKey: "help.commands.slot",
  cooldownMs: 4000,
  args: slotArgs,
  parseArgs: (tokens) => {
    const bet = parseInt(tokens[0] ?? "50", 10);
    return { bet: isNaN(bet) ? 50 : Math.max(10, Math.min(10000, bet)) };
  },
  slash: () =>
    slashBase("slot", "Gira o Oráculo de Familiares (Pokéslot) para capturar criaturas e ganhar Éter!", "Spins the Familiar Slot Machine to capture creatures and win Aether!")
      .addIntegerOption((o) => o.setName("bet").setDescription("Valor da aposta em Éter (padrão: 50)").setMinValue(10).setMaxValue(10000).setRequired(false)),
  slashArgs: (i) => ({ bet: i.options.getInteger("bet") ?? 50 }),
  async execute(ctx: CommandContext<z.infer<typeof slotArgs>>) {
    const bet = ctx.args?.bet ?? 50;
    try {
      const res = await spinSlotMachine(ctx.guild.id, ctx.user.id, ctx.user.username, bet);
      const embed = renderSlotEmbed(res, ctx.locale);
      const row = buildSlotRow(ctx.user.id, bet, res.newBalance);
      await ctx.reply({ embeds: [embed], components: [row] });
    } catch (err) {
      const msg = mapProgressionError(err, ctx.guildConfig.prefix);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

export const blackTeaCommand: AnyCommand = {
  name: "blacktea",
  aliases: ["bt", "tea"],
  category: "economy",
  descriptionKey: "help.commands.blacktea",
  cooldownMs: 5000,
  slash: () => slashBase("blacktea", "Inicia uma rodada rápida do Jogo de Palavras (Blacktea) valendo 200 Éter!", "Starts a quick round of the Blacktea word game for 200 Aether!"),
  async execute(ctx: CommandContext) {
    const round = pickTeaChallenge();
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...round.options.map((word, idx) =>
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:tea:${idx === round.correctIndex ? "1" : "0"}:${idx}`)
          .setLabel(word.toUpperCase())
          .setStyle(ButtonStyle.Secondary)
      )
    );

    const embed = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle("🍵 Salão de Chá Dimensional — Blacktea!")
      .setDescription(
        `Encontre rapidamente a palavra que contém a sequência exata de letras:\n\n` +
          `## 🔤 **[ ${round.syllable} ]**\n\n` +
          `⚡ *O primeiro jogador a clicar na palavra correta ganha **+200** ${emoji("aether")}!*`
      );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const greenTeaCommand: AnyCommand = {
  name: "greentea",
  aliases: ["gt"],
  category: "economy",
  descriptionKey: "help.commands.blacktea",
  cooldownMs: 5000,
  async execute(ctx: CommandContext) {
    const round = pickTeaChallenge();
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...round.options.map((word, idx) =>
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:tea:${idx === round.correctIndex ? "1" : "0"}:${idx}`)
          .setLabel(word.toUpperCase())
          .setStyle(ButtonStyle.Success)
      )
    );

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("🍵 Salão de Chá Verde — Greentea Speed!")
      .setDescription(
        `⚡ **Corrida de Velocidade!** Clique na palavra que contém o grupo de letras antes dos outros jogadores:\n\n` +
          `## 🔤 **[ ${round.syllable} ]**\n\n` +
          `Prêmio: **+250** ${emoji("aether")} para o dedo mais veloz!`
      );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const redTeaCommand: AnyCommand = {
  name: "redtea",
  aliases: ["rtgame"],
  category: "economy",
  descriptionKey: "help.commands.blacktea",
  cooldownMs: 5000,
  async execute(ctx: CommandContext) {
    const round = pickTeaChallenge();
    const sortedByLen = [...round.options].sort((a, b) => b.length - a.length);
    const longest = sortedByLen[0]!;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...round.options.map((word, idx) =>
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:tea:${word === longest ? "1" : "0"}:${idx}`)
          .setLabel(word.toUpperCase())
          .setStyle(ButtonStyle.Danger)
      )
    );

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("🍵 Salão de Chá Vermelho — Redtea!")
      .setDescription(
        `🔥 **Desafio da Palavra Mais Longa!** Encontre a palavra que contém a sequência e possui o MAIOR número de caracteres:\n\n` +
          `## 🔤 **[ ${round.syllable} ]**\n\n` +
          `Prêmio: **+300** ${emoji("aether")} Éter!`
      );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const yellowTeaCommand: AnyCommand = {
  name: "yellowtea",
  aliases: ["yt"],
  category: "economy",
  descriptionKey: "help.commands.blacktea",
  cooldownMs: 5000,
  async execute(ctx: CommandContext) {
    const round = pickTeaChallenge();
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...round.options.map((word, idx) =>
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:tea:${idx === round.correctIndex ? "1" : "0"}:${idx}`)
          .setLabel(word.toUpperCase())
          .setStyle(ButtonStyle.Primary)
      )
    );

    const embed = new EmbedBuilder()
      .setColor(0xeab308)
      .setTitle("🍵 Salão de Chá Dourado — Yellowtea!")
      .setDescription(
        `⭐ **Desafio de Resistência!** Clique na palavra válida para marcar pontos da rodada:\n\n` +
          `## 🔤 **[ ${round.syllable} ]**\n\n` +
          `Prêmio: **+200** ${emoji("aether")} Éter!`
      );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const mixTeaCommand: AnyCommand = {
  name: "mixtea",
  aliases: ["mt"],
  category: "economy",
  descriptionKey: "help.commands.blacktea",
  cooldownMs: 5000,
  async execute(ctx: CommandContext) {
    const round = pickTeaChallenge();
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...round.options.map((word, idx) =>
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:tea:${idx === round.correctIndex ? "1" : "0"}:${idx}`)
          .setLabel(word.toUpperCase())
          .setStyle(ButtonStyle.Secondary)
      )
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("🍵 Salão de Chá Místico — Mixtea!")
      .setDescription(
        `🌀 **Regras Mutantes!** O padrão dimensional foi alterado. Descubra o enigma da sequência:\n\n` +
          `## 🔤 **[ ${round.syllable} ]**\n\n` +
          `Prêmio: **+350** ${emoji("aether")} Éter!`
      );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

const targetOptionalArgs = z.object({
  target: z.string().optional(),
});

const questionOptionalArgs = z.object({
  question: z.string().default(""),
});

export const pokeDuelCommand: AnyCommand = {
  name: "pokeduel",
  aliases: ["familiarbattle", "duelofamiliar"],
  category: "economy",
  descriptionKey: "help.commands.arena",
  args: targetOptionalArgs,
  parseArgs: (tokens) => ({ target: tokens[0] }),
  cooldownMs: 3000,
  async execute(ctx: CommandContext<z.infer<typeof targetOptionalArgs>>) {
    const rawTarget = ctx.args.target;
    const opponentId = parseUserId(rawTarget);
    const p = ctx.guildConfig.prefix;

    const res = await runArenaBattle(ctx.guild.id, ctx.user.id, opponentId);
    const won = res.winnerId === ctx.user.id;

    const embed = new EmbedBuilder()
      .setColor(won ? 0x10b981 : 0xef4444)
      .setTitle(`⚔️ Duelo de Familiares do Cassino — ${won ? "Vitória!" : "Derrota!"}`)
      .setDescription(
        `**${ctx.user.displayName ?? ctx.user.username}** enviou seu **${res.fighterA.cardName}** para a batalha!\n\n` +
          `▸ **Seu Lutador:** ATK ${res.fighterA.atk} • DEF ${res.fighterA.def} • SPD ${res.fighterA.spd} • HP ${res.fighterA.hp}\n` +
          `▸ **Adversário:** ${res.fighterB.cardName} (ATK ${res.fighterB.atk} • DEF ${res.fighterB.def} • SPD ${res.fighterB.spd} • HP ${res.fighterB.hp})\n\n` +
          `Duração: **${res.rounds}** rounds de combate intenso!\n` +
          (won
            ? `🏆 **Você venceu a partida e faturou +${res.rewardAether} ${emoji("aether")} Éter!**`
            : `💀 Seu lutador foi superado. Tente novamente ou consiga familiares mais fortes em \`${p}slot\`!`)
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:pokeduel_again:${ctx.user.id}:${opponentId ?? "none"}`)
        .setLabel("⚔️ Duelo Novamente")
        .setStyle(ButtonStyle.Primary)
    );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const fateCommand: AnyCommand = {
  name: "fate",
  aliases: ["afinidade", "lovemeter"],
  category: "economy",
  descriptionKey: "help.commands.arena",
  args: targetOptionalArgs,
  parseArgs: (tokens) => ({ target: tokens[0] }),
  cooldownMs: 3000,
  async execute(ctx: CommandContext<z.infer<typeof targetOptionalArgs>>) {
    const rawTarget = ctx.args.target;
    const targetId = parseUserId(rawTarget) ?? ctx.user.id;
    const targetUser = await ctx.guild.client.users.fetch(targetId).catch(() => null);
    const targetName = targetUser?.displayName ?? targetUser?.username ?? "Espírito Astral";

    const { score, verdict, cardA, cardB } = await calculateCosmicFate(ctx.guild.id, ctx.user.id, targetId);

    const filled = Math.round(score / 10);
    const empty = 10 - filled;
    const bar = "▰".repeat(filled) + "▱".repeat(empty);

    const embed = new EmbedBuilder()
      .setColor(score >= 70 ? 0xec4899 : score >= 40 ? 0x8b5cf6 : 0x64748b)
      .setTitle(`🔮 Oráculo de Afinidade Cósmica — Lovemeter`)
      .setDescription(
        `Conexão astral entre as almas e cartas dimensionais:\n` +
          `**${ctx.user.displayName ?? ctx.user.username}** ⚡ **${targetName}**\n\n` +
          `### 💖 Sincronia Astral: **${score}%**\n` +
          `\`[${bar}]\`\n\n` +
          (cardA && cardB ? `🃏 **Guardiões Espirituais:** **${cardA}** ✦ **${cardB}**\n\n` : "") +
          `📜 **Veredito das Estrelas:**\n${verdict}`
      );

    if (targetUser?.displayAvatarURL()) {
      embed.setThumbnail(targetUser.displayAvatarURL());
    }

    await ctx.reply({ embeds: [embed] });
  },
};

export const ball42Command: AnyCommand = {
  name: "42ball",
  aliases: ["8ball", "magicball", "oraculo"],
  category: "economy",
  descriptionKey: "help.commands.arena",
  args: questionOptionalArgs,
  parseArgs: (tokens) => ({ question: tokens.join(" ").trim() }),
  cooldownMs: 2000,
  async execute(ctx: CommandContext<z.infer<typeof questionOptionalArgs>>) {
    const question = ctx.args.question;
    const answer = get42BallAnswer();

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("🔮 Oráculo Multiversal — 42Ball")
      .setDescription(
        (question ? `❓ **Pergunta:** *"${question}"*\n\n` : "") +
          `🎱 **Resposta Dimensional:**\n${answer}`
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:ball42_again:${ctx.user.id}`)
        .setLabel("🔮 Perguntar Novamente")
        .setStyle(ButtonStyle.Primary)
    );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const quoteCommand: AnyCommand = {
  name: "quote",
  aliases: ["frase", "animequote"],
  category: "economy",
  descriptionKey: "help.commands.arena",
  cooldownMs: 2000,
  async execute(ctx: CommandContext) {
    const q = getRandomQuote();

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`📜 Frases Lendárias — ${q.series}`)
      .setDescription(`*"${q.quote}"*\n\n— **${q.character}**`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:quote_again:${ctx.user.id}`)
        .setLabel("📜 Nova Frase Lendária")
        .setStyle(ButtonStyle.Secondary)
    );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const beamCommand: AnyCommand = {
  name: "beam",
  aliases: ["kamehameha", "raio", "cero"],
  category: "economy",
  descriptionKey: "help.commands.arena",
  args: targetOptionalArgs,
  parseArgs: (tokens) => ({ target: tokens[0] }),
  cooldownMs: 3000,
  async execute(ctx: CommandContext<z.infer<typeof targetOptionalArgs>>) {
    const rawTarget = ctx.args.target;
    const targetId = parseUserId(rawTarget);
    const targetUser = targetId ? await ctx.guild.client.users.fetch(targetId).catch(() => null) : null;
    const targetName = targetUser?.displayName ?? targetUser?.username;

    const beam = generateAetherBeam(!!targetId, targetName);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:beam_absorb:${beam.shardAether}:${ctx.user.id}`)
        .setLabel(`💎 Coletar Fragmento Cósmico (+${beam.shardAether} Éter)`)
        .setStyle(ButtonStyle.Success)
    );

    const embed = new EmbedBuilder()
      .setColor(beam.color)
      .setTitle("⚡ DISPARO DIMENSIONAL — AETHER BEAM!")
      .setDescription(
        `💥 **Artilheiro:** <@${ctx.user.id}>\n` +
          (targetName ? `🎯 **Alvo Marcado:** **${targetName}**\n` : `🎯 **Alvo:** Tecido do Multiverso Espaço-Temporal\n`) +
          `\n` +
          `⚡ **Classificação do Disparo:** \`${beam.tierName}\`\n` +
          `🔋 **Potência de Saída:** \`${beam.powerWatts} GW (Gigawatts)\`\n\n` +
          `${beam.impactStatus}\n\n` +
          `💎 **Fenda Energética:**\n` +
          `A detonação expeliu **+${beam.shardAether}** ${emoji("aether")} no canal! Qualquer jogador pode clicar no botão abaixo para absorver o fragmento!`
      )
      .setImage("https://yo-apollon.github.io/kogu/assets/kogu_banner_animated.gif");

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export function renderBlackjackEmbed(game: BlackjackGame, isOver: boolean, locale: string = "pt-BR"): EmbedBuilder {
  const isWon = game.status === "player_win" || game.status === "player_blackjack";
  const color = isOver
    ? isWon
      ? 0x22c55e
      : game.status === "push"
        ? 0xfacc15
        : 0xef4444
    : 0x3b82f6;

  let outcomeText = "Escolha sua jogada nos botões abaixo:";
  if (isOver) {
    if (game.status === "player_blackjack") {
      outcomeText = `🎉 **BLACKJACK NATURAL!** Você recebeu **+${formatNumber(game.rewardAether, locale)}** ${emoji("aether")} *(Pagamento 3:2)*!`;
    } else if (game.status === "player_win") {
      outcomeText = `🎉 **VITÓRIA!** Você venceu o Dealer e recebeu **+${formatNumber(game.rewardAether, locale)}** ${emoji("aether")}!`;
    } else if (game.status === "dealer_bust") {
      outcomeText = `💥 **DEALER ESTOUROU!** Você recebeu **+${formatNumber(game.rewardAether, locale)}** ${emoji("aether")}!`;
    } else if (game.status === "push") {
      outcomeText = `⚖️ **EMPATE (PUSH)!** Sua aposta de **${formatNumber(game.rewardAether, locale)}** ${emoji("aether")} foi devolvida.`;
    } else if (game.status === "player_bust") {
      outcomeText = `💥 **VOCÊ ESTOUROU!** Passou de 21 e perdeu **${formatNumber(game.bet, locale)}** ${emoji("aether")}.`;
    } else {
      outcomeText = `💀 **DERROTA!** O Dealer superou sua mão. Você perdeu **${formatNumber(game.bet, locale)}** ${emoji("aether")}.`;
    }
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle("🃏 Cassino Astral — 21 / Blackjack")
    .setDescription(
      `👤 **Sua Mão:** ${formatCards(game.playerCards)} *(Total: **${game.playerScore}**)*\n` +
        `🤖 **Mão do Dealer:** ${formatCards(game.dealerCards, !isOver)} ${isOver ? `*(Total: **${game.dealerScore}**)*` : ""}\n\n` +
        `💰 **Aposta:** **${formatNumber(game.bet, locale)}** ${emoji("aether")}\n\n` +
        outcomeText
    );
}

export function buildBlackjackPlayingRow(sessionId: string, userId: string, canDouble: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PROGRESSION_NS}:bj_hit:${sessionId}:${userId}`)
      .setLabel("🃏 Pedir Carta (Hit)")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PROGRESSION_NS}:bj_stand:${sessionId}:${userId}`)
      .setLabel("✋ Parar (Stand)")
      .setStyle(ButtonStyle.Secondary)
  );
  if (canDouble) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:bj_double:${sessionId}:${userId}`)
        .setLabel("💰 Dobrar (Double)")
        .setStyle(ButtonStyle.Success)
    );
  }
  return row;
}

export function buildBlackjackReplayRow(userId: string, bet: number, currentBalance?: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  const canReplaySame = currentBalance === undefined || currentBalance >= bet;
  const canDouble = currentBalance === undefined || currentBalance >= bet * 2;

  if (canReplaySame) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:bj_again:${bet}:${userId}`)
        .setLabel(`🔁 Jogar Novamente (${formatNumber(bet, "pt-BR")} Éter)`)
        .setStyle(ButtonStyle.Primary)
    );
    if (canDouble && bet * 2 <= 50000) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:bj_again:${Math.min(50000, bet * 2)}:${userId}`)
          .setLabel(`💰 Dobrar (${formatNumber(Math.min(50000, bet * 2), "pt-BR")} Éter)`)
          .setStyle(ButtonStyle.Success)
      );
    }
  } else if (currentBalance !== undefined && currentBalance >= 10) {
    const availableBet = Math.min(bet, currentBalance);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:bj_again:${availableBet}:${userId}`)
        .setLabel(`🔁 Apostar Restante (${formatNumber(availableBet, "pt-BR")} Éter)`)
        .setStyle(ButtonStyle.Danger)
    );
  }

  if (bet > 50 && (currentBalance === undefined || currentBalance >= 50)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:bj_again:50:${userId}`)
        .setLabel("🪙 Mínima (50 Éter)")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (currentBalance !== undefined && currentBalance < 10) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:eco_daily:${userId}`)
        .setLabel("🎁 Resgatar Diário ($daily)")
        .setStyle(ButtonStyle.Success)
    );
  }

  return row;
}

const blackjackArgs = z.object({
  bet: z.number().int().min(10).max(50000).default(50),
});

export const blackjackCommand: AnyCommand = {
  name: "blackjack",
  aliases: ["bj", "21"],
  category: "economy",
  descriptionKey: "help.commands.blackjack",
  args: blackjackArgs,
  parseArgs: (tokens) => {
    const bet = parseInt(tokens[0] ?? "50", 10);
    return { bet: isNaN(bet) ? 50 : Math.max(10, Math.min(50000, bet)) };
  },
  cooldownMs: 3000,
  slash: () =>
    slashBase("blackjack", "Joga uma partida de 21 / Blackjack apostando Éter!", "Plays a 21 / Blackjack match betting Aether!")
      .addIntegerOption((o) => o.setName("bet").setDescription("Valor da aposta em Éter (padrão: 50)").setMinValue(10).setMaxValue(50000).setRequired(false)),
  slashArgs: (i) => ({ bet: i.options.getInteger("bet") ?? 50 }),
  async execute(ctx: CommandContext<z.infer<typeof blackjackArgs>>) {
    const bet = ctx.args?.bet ?? 50;
    try {
      const game = await startBlackjack(ctx.guild.id, ctx.user.id, ctx.user.username, bet);
      const isOver = game.gameOver;
      const embed = renderBlackjackEmbed(game, isOver, ctx.locale);

      if (!isOver) {
        const row = buildBlackjackPlayingRow(game.sessionId, ctx.user.id, game.playerCards.length === 2);
        await ctx.reply({ embeds: [embed], components: [row] });
      } else {
        const replayRow = buildBlackjackReplayRow(ctx.user.id, game.bet, game.newBalance);
        await ctx.reply({ embeds: [embed], components: [replayRow] });
      }
    } catch (err) {
      const msg = mapProgressionError(err, ctx.guildConfig.prefix);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

export function renderCoinflipEmbed(res: CoinflipResult, locale: string = "pt-BR"): EmbedBuilder {
  const icon = res.flipped === "cara" ? "🪙" : "👑";
  return new EmbedBuilder()
    .setColor(res.won ? 0x22c55e : 0xef4444)
    .setTitle(`🪙 Cara ou Coroa Astral — Deu ${res.flipped.toUpperCase()}! ${icon}`)
    .setDescription(
      `👤 **Sua Escolha:** **${res.choice.toUpperCase()}**\n` +
        `🎲 **Resultado:** **${res.flipped.toUpperCase()}**\n\n` +
        (res.won
          ? `🎉 **VITÓRIA!** Você dobrou sua aposta e faturou **+${formatNumber(res.payout, locale)}** ${emoji("aether")}!\n`
          : `💀 **DERROTA!** A moeda estelar caiu contra você. Você perdeu **${formatNumber(res.bet, locale)}** ${emoji("aether")}.\n`) +
        `💰 **Saldo Atual:** **${formatNumber(res.newBalance, locale)}** ${emoji("aether")}`
    );
}

export function buildCoinflipReplayRow(userId: string, bet: number, choice: "cara" | "coroa"): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PROGRESSION_NS}:cf_replay:${userId}:${bet}:cara`)
      .setLabel(`🪙 Jogar Cara (${formatNumber(bet, "pt-BR")})`)
      .setStyle(choice === "cara" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PROGRESSION_NS}:cf_replay:${userId}:${bet}:coroa`)
      .setLabel(`👑 Jogar Coroa (${formatNumber(bet, "pt-BR")})`)
      .setStyle(choice === "coroa" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PROGRESSION_NS}:cf_replay:${userId}:${Math.min(50000, bet * 2)}:${choice}`)
      .setLabel(`💰 Dobrar (${formatNumber(Math.min(50000, bet * 2), "pt-BR")})`)
      .setStyle(ButtonStyle.Success)
  );
  if (bet > 50) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PROGRESSION_NS}:cf_replay:${userId}:50:${choice}`)
        .setLabel("🪙 Mínima (50)")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return row;
}

const coinflipArgs = z.object({
  bet: z.number().int().min(10).max(50000).default(50),
  choice: z.enum(["cara", "coroa"]).optional(),
});

export const coinflipCommand: AnyCommand = {
  name: "coinflip",
  aliases: ["cf", "moeda", "flip"],
  category: "economy",
  descriptionKey: "help.commands.coinflip",
  args: coinflipArgs,
  parseArgs: (tokens) => {
    let bet = 50;
    let choice: "cara" | "coroa" | undefined;
    for (const t of tokens) {
      const lower = t.toLowerCase();
      if (lower === "cara" || lower === "coroa") {
        choice = lower;
      } else {
        const parsed = parseInt(t, 10);
        if (!isNaN(parsed)) bet = Math.max(10, Math.min(50000, parsed));
      }
    }
    return { bet, choice };
  },
  cooldownMs: 2000,
  slash: () =>
    slashBase("coinflip", "Joga Cara ou Coroa apostando Éter!", "Plays Coinflip betting Aether!")
      .addIntegerOption((o) => o.setName("bet").setDescription("Valor da aposta em Éter (padrão: 50)").setMinValue(10).setMaxValue(50000).setRequired(false))
      .addStringOption((o) => o.setName("choice").setDescription("Cara ou Coroa").addChoices({ name: "Cara", value: "cara" }, { name: "Coroa", value: "coroa" }).setRequired(false)),
  slashArgs: (i) => ({
    bet: i.options.getInteger("bet") ?? 50,
    choice: (i.options.getString("choice") as "cara" | "coroa") ?? undefined,
  }),
  async execute(ctx: CommandContext<z.infer<typeof coinflipArgs>>) {
    const bet = ctx.args?.bet ?? 50;
    const choice = ctx.args?.choice;

    if (!choice) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:cf_pick:${ctx.user.id}:${bet}:cara`)
          .setLabel("🪙 Escolher Cara")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:cf_pick:${ctx.user.id}:${bet}:coroa`)
          .setLabel("👑 Escolher Coroa")
          .setStyle(ButtonStyle.Secondary)
      );

      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("🪙 Cara ou Coroa Astral — Escolha seu Lado!")
        .setDescription(
          `Aposta atual: **${formatNumber(bet, ctx.locale)}** ${emoji("aether")}\n\n` +
            `Clique em **Cara** ou **Coroa** para lançar a moeda estelar!\n` +
            `*Se acertar, dobra sua aposta (+${formatNumber(bet * 2, ctx.locale)} Éter)!*`
        );

      await ctx.reply({ embeds: [embed], components: [row] });
      return;
    }

    try {
      const res = await runCoinflip(ctx.guild.id, ctx.user.id, ctx.user.username, bet, choice);
      const embed = renderCoinflipEmbed(res, ctx.locale);
      const replayRow = buildCoinflipReplayRow(ctx.user.id, bet, choice);
      await ctx.reply({ embeds: [embed], components: [replayRow] });
    } catch (err) {
      const msg = mapProgressionError(err, ctx.guildConfig.prefix);
      if (msg) {
        await ctx.reply({ content: msg, ephemeral: true });
        return;
      }
      throw err;
    }
  },
};

export const quizCommand: AnyCommand = {
  name: "quiz",
  aliases: ["trivia"],
  category: "economy",
  descriptionKey: "help.commands.quiz",
  cooldownMs: 5000,
  slash: () => slashBase("quiz", "Inicia um Quiz sobre os personagens do catálogo valendo 150 Éter!", "Starts a catalog character Quiz for 150 Aether!"),
  async execute(ctx: CommandContext) {
    const q = await generateQuizQuestion();
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...q.options.map((opt, idx) =>
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:quiz:${idx === q.correctIndex ? "1" : "0"}:${idx}`)
          .setLabel(opt.slice(0, 80))
          .setStyle(ButtonStyle.Primary)
      )
    );

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("🧠 Quiz Dimensional — Qual é a Obra/Franquia?")
      .setDescription(
        `A qual série, jogo ou franquia pertence o personagem:\n\n` +
          `## 🌟 **${q.characterName}**\n\n` +
          `⚡ *Clique na resposta correta para ganhar **+150** ${emoji("aether")}!*`
      );
    if (q.imageUrl) embed.setThumbnail(q.imageUrl);

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

export const inviteCommand: AnyCommand = {
  name: "invite",
  aliases: ["convite", "join", "vote", "legal"],
  category: "help",
  descriptionKey: "help.commands.invite",
  cooldownMs: 3000,
  slash: () => slashBase("invite", "Exibe o link de convite oficial do Kogu, Termos de Uso e Política de Privacidade.", "Shows Kogu's official invite link, Terms of Service and Privacy Policy."),
  async execute(ctx: CommandContext) {
    const clientId = process.env.DISCORD_CLIENT_ID ?? "1561074418250416178";
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=412317240384&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🌌 Kogu — Convite Oficial & Links Públicos")
      .setDescription(
        `Traga o **Kogu** para o seu servidor Discord e desbloqueie o sistema completo de Gacha, Trocas, Arena RPG e Catálogo Multiverso!\n\n` +
          `🔗 **[Adicionar o Kogu ao seu Servidor](${inviteUrl})**\n` +
          `📜 **[Termos de Serviço (ToS)](https://github.com/yo-apollon/kogu/blob/main/docs/TERMS.md)**\n` +
          `🔒 **[Política de Privacidade](https://github.com/yo-apollon/kogu/blob/main/docs/PRIVACY.md)**`
      );

    await ctx.reply({ embeds: [embed] });
  },
};

/* ------------------------------------------------------------------ */
/* Handler de Componentes (Torre, Quiz, Blacktea)                     */
/* ------------------------------------------------------------------ */

export const progressionComponentHandler: ComponentHandler = {
  namespace: PROGRESSION_NS,
  async handle(interaction, parts) {
    if (!interaction.isButton()) return;
    const [action, arg1] = parts;
    const guildId = interaction.guildId;
    if (!guildId) return;

    if (action === "tbuild" || action === "tdestroy") {
      if (interaction.user.id !== arg1) {
        await interaction.reply({
          content: "⛔ Apenas o dono deste painel pode interagir com a própria Torre.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      try {
        if (action === "tbuild") {
          await buildTowerFloor(guildId, interaction.user.id, undefined, interaction.user.username);
        } else {
          await destroyTower(guildId, interaction.user.id, interaction.user.username);
        }
        const nextState = await getTowerState(guildId, interaction.user.id, interaction.user.username);
        const embed = renderTowerEmbed(nextState, "$", "pt-BR");
        const row = buildTowerButtons(interaction.user.id, nextState.level);
        await interaction.update({ embeds: [embed], components: [row] });
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⚠️ Não foi possível atualizar a Torre.";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "beam_absorb") {
      const shard = parseInt(arg1 ?? "100", 10) || 100;
      const newBal = await credit(guildId, interaction.user.id, shard, {
        username: interaction.user.username,
      });

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:beam_absorbed:${interaction.user.id}`)
          .setLabel(`✅ Coletado por @${interaction.user.displayName ?? interaction.user.username} (+${shard} Éter)`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await interaction.update({
        content: `✨ <@${interaction.user.id}> absorveu a fenda cósmica e coletou **+${shard}** ${emoji("aether")} Éter! *(Saldo: **${formatNumber(newBal, "pt-BR")}**)*`,
        components: [disabledRow],
      });
      return;
    }

    if (action === "slot_spin") {
      if (interaction.user.id !== arg1) {
        await interaction.reply({
          content: "⛔ Apenas o jogador que invocou esta máquina caça-níqueis pode girar novamente.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const bet = parseInt(parts[2] ?? "50", 10) || 50;

      try {
        const res = await spinSlotMachine(guildId, interaction.user.id, interaction.user.username, bet);
        const embed = renderSlotEmbed(res, "pt-BR");
        const row = buildSlotRow(interaction.user.id, bet);
        await interaction.update({ embeds: [embed], components: [row] });
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⚠️ Não foi possível girar o Pokéslot.";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "arena_again") {
      const originalUserId = arg1;
      const oppIdStr = parts[2];
      if (interaction.user.id !== originalUserId) {
        await interaction.reply({
          content: "⛔ Apenas o duelista que desafiou a Arena pode solicitar revanche imediata.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const oppId = oppIdStr === "none" ? undefined : oppIdStr;
        const battle = await runArenaBattle(guildId, interaction.user.id, oppId);
        const oppLabel = oppId ? `<@${oppId}>` : "🛡️ Guardião do Obelisco";
        const won = battle.winnerId === interaction.user.id;
        const winLabel = battle.winnerId === "guardian" ? "🛡️ Guardião do Obelisco" : `<@${battle.winnerId}>`;

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${PROGRESSION_NS}:arena_again:${interaction.user.id}:${oppId ?? "none"}`)
            .setLabel("⚔️ Lutar Novamente")
            .setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
          .setColor(won ? 0x22c55e : 0xef4444)
          .setTitle(`⚔️ Arena Dimensional — ${won ? "Vitória Épica!" : "Derrota no Combate!"}`)
          .setDescription(
            `### ⚔️ Confronto de Campeões\n` +
              `🔹 **<@${interaction.user.id}>** convocou **${battle.fighterA.cardName}**\n` +
              `${renderHpBar(battle.finalHpA, battle.fighterA.hp)} *(ATK ${battle.fighterA.atk} · DEF ${battle.fighterA.def} · SPD ${battle.fighterA.spd})*\n\n` +
              `🔸 **${oppLabel}** convocou **${battle.fighterB.cardName}**\n` +
              `${renderHpBar(battle.finalHpB, battle.fighterB.hp)} *(ATK ${battle.fighterB.atk} · DEF ${battle.fighterB.def} · SPD ${battle.fighterB.spd})*\n\n` +
              `📜 **Relatório do Combate:**\n` +
              battle.log.map((l) => `▸ ${l}`).join("\n") +
              `\n\n` +
              `🏆 **Vencedor:** ${winLabel} com **${battle.winnerCard}**!\n` +
              (won
                ? `🎁 **Recompensa:** **+${formatNumber(battle.rewardAether, "pt-BR")}** ${emoji("aether")} *(Lucro: **+${formatNumber(battle.netProfit, "pt-BR")}**)*`
                : `💀 **Derrota!** Seu combatente foi nocauteado. Você perdeu a taxa de desafio de **-${battle.fee}** ${emoji("aether")}.`)
          );

        if (battle.fighterA.imageUrl) {
          embed.setThumbnail(battle.fighterA.imageUrl);
        }

        await interaction.update({ embeds: [embed], components: [row] });
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⚠️ Não foi possível realizar a batalha.";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "pokeduel_again") {
      const originalUserId = arg1;
      const oppIdStr = parts[2];
      if (interaction.user.id !== originalUserId) {
        await interaction.reply({
          content: "⛔ Apenas o duelista que iniciou a batalha pode solicitar revanche.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const oppId = oppIdStr === "none" ? undefined : oppIdStr;
        const res = await runArenaBattle(guildId, interaction.user.id, oppId);
        const won = res.winnerId === interaction.user.id;
        const embed = new EmbedBuilder()
          .setColor(won ? 0x10b981 : 0xef4444)
          .setTitle(`⚔️ Duelo de Familiares do Cassino — ${won ? "Vitória!" : "Derrota!"}`)
          .setDescription(
            `**${interaction.user.displayName ?? interaction.user.username}** enviou seu **${res.fighterA.cardName}** para a batalha!\n\n` +
              `▸ **Seu Lutador:** ATK ${res.fighterA.atk} • DEF ${res.fighterA.def} • SPD ${res.fighterA.spd} • HP ${res.fighterA.hp}\n` +
              `▸ **Adversário:** ${res.fighterB.cardName} (ATK ${res.fighterB.atk} • DEF ${res.fighterB.def} • SPD ${res.fighterB.spd} • HP ${res.fighterB.hp})\n\n` +
              `Duração: **${res.rounds}** rounds de combate intenso!\n` +
              (won
                ? `🏆 **Você venceu a partida e faturou +${res.rewardAether} ${emoji("aether")} Éter!**`
                : `💀 Seu lutador foi superado. Tente novamente ou consiga familiares mais fortes em \`$slot\`!`)
          );

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${PROGRESSION_NS}:pokeduel_again:${interaction.user.id}:${oppId ?? "none"}`)
            .setLabel("⚔️ Duelo Novamente")
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.update({ embeds: [embed], components: [row] });
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⚠️ Não foi possível realizar o duelo.";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "bj_hit" || action === "bj_stand" || action === "bj_double") {
      const sessionId = arg1;
      const ownerId = parts[2];
      if (interaction.user.id !== ownerId) {
        await interaction.reply({
          content: "⛔ Esta mesa de Blackjack pertence a outro jogador.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        let game =
          action === "bj_hit"
            ? await hitBlackjack(sessionId)
            : action === "bj_stand"
              ? await standBlackjack(sessionId)
              : await doubleBlackjack(sessionId);

        const isOver = game.gameOver;
        const embed = renderBlackjackEmbed(game, isOver, "pt-BR");

        if (!isOver) {
          const row = buildBlackjackPlayingRow(game.sessionId, interaction.user.id, game.playerCards.length === 2);
          await interaction.update({ embeds: [embed], components: [row] });
        } else {
          const replayRow = buildBlackjackReplayRow(interaction.user.id, game.bet, game.newBalance);
          await interaction.update({ embeds: [embed], components: [replayRow] });
        }
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⚠️ Não foi possível processar a jogada.";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "bj_again") {
      const bet = parseInt(arg1 ?? "50", 10) || 50;
      const ownerId = parts[2];
      if (interaction.user.id !== ownerId) {
        await interaction.reply({
          content: "⛔ Esta mesa de Blackjack pertence a outro jogador.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const game = await startBlackjack(guildId, interaction.user.id, interaction.user.username, bet);
        const isOver = game.gameOver;
        const embed = renderBlackjackEmbed(game, isOver, "pt-BR");

        if (!isOver) {
          const row = buildBlackjackPlayingRow(game.sessionId, interaction.user.id, game.playerCards.length === 2);
          await interaction.update({ embeds: [embed], components: [row] });
        } else {
          const replayRow = buildBlackjackReplayRow(interaction.user.id, game.bet, game.newBalance);
          await interaction.update({ embeds: [embed], components: [replayRow] });
        }
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⚠️ Não foi possível iniciar uma nova rodada de Blackjack.";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "eco_daily") {
      try {
        const result = await claimDaily(guildId, interaction.user.id, { username: interaction.user.username });
        const embed = dailyEmbed({ result, baseRolls: 10, locale: "pt-BR" });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⏳ Você já resgatou seu Diário hoje. Tente novamente mais tarde!";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "cf_pick" || action === "cf_replay") {
      const ownerId = arg1;
      const bet = parseInt(parts[2] ?? "50", 10) || 50;
      const choice = parts[3] as "cara" | "coroa";

      if (interaction.user.id !== ownerId) {
        await interaction.reply({
          content: "⛔ Apenas o jogador que invocou a Moeda Astral pode jogar.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const res = await runCoinflip(guildId, interaction.user.id, interaction.user.username, bet, choice);
        const embed = renderCoinflipEmbed(res, "pt-BR");
        const replayRow = buildCoinflipReplayRow(interaction.user.id, bet, choice);
        await interaction.update({ embeds: [embed], components: [replayRow] });
      } catch (err) {
        const msg = mapProgressionError(err, "$") ?? "⚠️ Não foi possível lançar a moeda.";
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (action === "quiz") {
      const isCorrect = arg1 === "1";
      const reward = 150;
      if (!isCorrect) {
        await interaction.reply({
          content: "❌ Resposta incorreta! Tente na próxima pergunta!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const newBalance = await credit(guildId, interaction.user.id, reward, {
        username: interaction.user.username,
      });
      const nextRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:quiz_next:${interaction.user.id}`)
          .setLabel("🧠 Próxima Pergunta")
          .setStyle(ButtonStyle.Primary)
      );
      await interaction.update({
        content: `🏆 <@${interaction.user.id}> acertou primeiro e ganhou **+${reward}** ${emoji("aether")}! *(Saldo: **${formatNumber(newBalance, "pt-BR")}**)*`,
        components: [nextRow],
      });
      return;
    }

    if (action === "quiz_next") {
      const q = await generateQuizQuestion();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...q.options.map((opt, idx) =>
          new ButtonBuilder()
            .setCustomId(`${PROGRESSION_NS}:quiz:${idx === q.correctIndex ? "1" : "0"}:${idx}`)
            .setLabel(opt.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        )
      );

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🧠 Quiz Dimensional — Qual é a Obra/Franquia?")
        .setDescription(
          `A qual série, jogo ou franquia pertence o personagem:\n\n` +
            `## 🌟 **${q.characterName}**\n\n` +
            `⚡ *Clique na resposta correta para ganhar **+150** ${emoji("aether")}!*`
        );
      if (q.imageUrl) embed.setThumbnail(q.imageUrl);

      await interaction.update({ content: null, embeds: [embed], components: [row] });
      return;
    }

    if (action === "tea") {
      const isCorrect = arg1 === "1";
      const reward = 200;
      if (!isCorrect) {
        await interaction.reply({
          content: "❌ Resposta incorreta! Tente na próxima rodada!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const newBalance = await credit(guildId, interaction.user.id, reward, {
        username: interaction.user.username,
      });
      const teaRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:tea_next:standard`)
          .setLabel("🍵 Nova Rodada de Chá")
          .setStyle(ButtonStyle.Success)
      );
      await interaction.update({
        content: `🏆 <@${interaction.user.id}> acertou primeiro e ganhou **+${reward}** ${emoji("aether")}! *(Saldo: **${formatNumber(newBalance, "pt-BR")}**)*`,
        components: [teaRow],
      });
      return;
    }

    if (action === "tea_next") {
      const round = pickTeaChallenge();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...round.options.map((word, idx) =>
          new ButtonBuilder()
            .setCustomId(`${PROGRESSION_NS}:tea:${idx === round.correctIndex ? "1" : "0"}:${idx}`)
            .setLabel(word.toUpperCase())
            .setStyle(ButtonStyle.Secondary)
        )
      );

      const embed = new EmbedBuilder()
        .setColor(0xf97316)
        .setTitle("🍵 Salão de Chá Dimensional — Blacktea!")
        .setDescription(
          `Encontre rapidamente a palavra que contém a sequência exata de letras:\n\n` +
            `## 🔤 **[ ${round.syllable} ]**\n\n` +
            `⚡ *O primeiro jogador a clicar na palavra correta ganha **+200** ${emoji("aether")}!*`
        );

      await interaction.update({ content: null, embeds: [embed], components: [row] });
      return;
    }

    if (action === "ball42_again") {
      const answer = get42BallAnswer();
      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle("🔮 Oráculo Multiversal — 42Ball")
        .setDescription(`🎱 **Resposta Dimensional:**\n${answer}`);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:ball42_again:${interaction.user.id}`)
          .setLabel("🔮 Perguntar Novamente")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }

    if (action === "quote_again") {
      const q = getRandomQuote();
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`📜 Frases Lendárias — ${q.series}`)
        .setDescription(`*"${q.quote}"*\n\n— **${q.character}**`);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROGRESSION_NS}:quote_again:${interaction.user.id}`)
          .setLabel("📜 Nova Frase Lendária")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }
  },
};

export const commands: AnyCommand[] = [
  tutoCommand,
  skipTutoCommand,
  freeClaimCommand,
  resetTimerCommand,
  ktowerCommand,
  buildCommand,
  destroyCommand,
  lootboxCommand,
  giveKakeraCommand,
  infoKeysCommand,
  arenaCommand,
  slotCommand,
  blackjackCommand,
  coinflipCommand,
  blackTeaCommand,
  greenTeaCommand,
  redTeaCommand,
  yellowTeaCommand,
  mixTeaCommand,
  pokeDuelCommand,
  fateCommand,
  ball42Command,
  quoteCommand,
  beamCommand,
  quizCommand,
  inviteCommand,
];

export const components: ComponentHandler[] = [progressionComponentHandler];
