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
import { credit } from "../economy/service.js";
import { parseUserId } from "../economy/commands.js";
import { emoji } from "../../ui/emojis.js";
import { formatNumber } from "../../ui/format.js";
import { UserError } from "../../lib/errors.js";
import {
  activateFreeClaim,
  activateResetTimer,
  buildTowerFloor,
  claimTutorialRewards,
  destroyTower,
  generateQuizQuestion,
  getTowerState,
  LOOTBOX_COST,
  openLootbox,
  pickTeaChallenge,
  runArenaBattle,
  spinSlotMachine,
  TOWER_PERKS,
  transferAether,
} from "./service.js";

export const PROGRESSION_NS = "pg";

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
          `**1. Invocação de Cartas:** Digite \`${p}w\` (Waifus), \`${p}h\` (Husbandos), \`${p}wg\` (Games) ou \`${p}wc\` (Cinema/Doramas/Idols). Clique no botão de Pacto antes de 120s!\n` +
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
    const winLabel = battle.winnerId === "guardian" ? "🛡️ Guardião do Obelisco" : `<@${battle.winnerId}>`;

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("⚔️ Arena Dimensional — Combate Encerrado!")
      .setDescription(
        `🔹 **<@${ctx.user.id}>** convocou **${battle.fighterA.cardName}** *(ATK ${battle.fighterA.atk} · DEF ${battle.fighterA.def} · SPD ${battle.fighterA.spd} · HP ${battle.fighterA.hp})*\n` +
          `🔸 **${oppLabel}** convocou **${battle.fighterB.cardName}** *(ATK ${battle.fighterB.atk} · DEF ${battle.fighterB.def} · SPD ${battle.fighterB.spd} · HP ${battle.fighterB.hp})*\n\n` +
          `⚡ Após **${battle.rounds} turnos** de embate dimensional:\n` +
          `🏆 **Vencedor:** ${winLabel} com **${battle.winnerCard}**!\n` +
          `🎁 **Recompensa de Vitória:** **+${battle.rewardAether}** ${emoji("aether")}`
      );

    await ctx.reply({
      embeds: [embed],
      allowedMentions: { parse: [], users: oppId ? [oppId] : [] },
    });
  },
};

export const slotCommand: AnyCommand = {
  name: "slot",
  aliases: ["pokemon", "pokeslot", "cassino", "familiar", "pokedex"],
  category: "economy",
  descriptionKey: "help.commands.slot",
  cooldownMs: 4000,
  slash: () => slashBase("slot", "Gira o Oráculo de Familiares (Pokéslot) para capturar criaturas e ganhar Éter!", "Spins the Familiar Slot Machine to capture creatures and win Aether!"),
  async execute(ctx: CommandContext) {
    const res = await spinSlotMachine(ctx.guild.id, ctx.user.id, ctx.user.username);
    const [r1, r2, r3] = res.reels;

    const headline = res.isJackpot
      ? `🎉 **JACKPOT DIMENSIONAL! TRINCA PERFEITA!**`
      : res.won
        ? `✨ **PAR ENCONTRADO! FAMILIAR CAPTURADO!**`
        : `🎰 **Oráculo Girado — Recompensa de Consolação!**`;

    const embed = new EmbedBuilder()
      .setColor(res.isJackpot ? 0xfacc15 : res.won ? 0x22c55e : 0x6366f1)
      .setTitle("🎰 Oráculo de Familiares — Pokéslot Dimensional")
      .setDescription(
        `### ╔═══════════════╗\n` +
          `### ║  ${r1.emoji}  │  ${r2.emoji}  │  ${r3.emoji}  ║\n` +
          `### ╚═══════════════╝\n\n` +
          `${headline}\n` +
          (res.won ? `🐾 **Criatura:** **${res.capturedName}**\n` : "") +
          `💠 **Prêmio:** **+${formatNumber(res.aetherReward, ctx.locale)}** ${emoji("aether")}\n` +
          `💰 **Saldo Atual:** **${formatNumber(res.newBalance, ctx.locale)}** ${emoji("aether")}`
      );

    await ctx.reply({ embeds: [embed] });
  },
};

export const blackTeaCommand: AnyCommand = {
  name: "blacktea",
  aliases: ["bt", "greentea", "redtea", "tea"],
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

    if (action === "tea" || action === "quiz") {
      const isCorrect = arg1 === "1";
      const reward = action === "tea" ? 200 : 150;
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
      await interaction.update({
        content: `🏆 <@${interaction.user.id}> acertou primeiro e ganhou **+${reward}** ${emoji("aether")}! *(Saldo: **${formatNumber(newBalance, "pt-BR")}**)*`,
        components: [],
      });
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
  blackTeaCommand,
  quizCommand,
  inviteCommand,
];

export const components: ComponentHandler[] = [progressionComponentHandler];
