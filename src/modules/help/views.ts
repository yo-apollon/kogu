/** Views do modulo HELP: embeds da central de ajuda e secoes do painel (select de categorias). */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
} from "discord.js";
import type { Locale } from "../../config/constants.js";
import { emoji } from "../../ui/emojis.js";
import { baseEmbed } from "../../ui/embeds.js";
import { truncate } from "../../ui/format.js";
import type { PanelSection } from "../../ui/components/panel.js";
import type { AnyRow } from "../../ui/components/paginator.js";
import { msg } from "./messages.js";
import type { HelpEntry, HelpGroup } from "./service.js";

export const OVERVIEW_SECTION_ID = "overview";
const EMBED_DESCRIPTION_SOFT_LIMIT = 3800;
const MAX_EMBEDS_PER_CATEGORY = 3;
const FOOTER_MAX = 2048;
const SELECT_DESCRIPTION_MAX = 100;

export const KOGU_AVATAR_URL =
  "https://yo-apollon.github.io/kogu/assets/kogu_avatar_animated.gif";
export const KOGU_PORTAL_URL = "https://yo-apollon.github.io/kogu/";
export const KOGU_TERMS_URL = "https://yo-apollon.github.io/kogu/terms.html";
export const KOGU_PRIVACY_URL = "https://yo-apollon.github.io/kogu/privacy.html";
export const KOGU_INVITE_URL =
  "https://discord.com/oauth2/authorize?client_id=1561074418250416178&permissions=412317240384&scope=bot%20applications.commands";

/** Rodape limpo e elegante de todas as telas. Zero informacoes de APIs ou avisos legais desnecessarios. */
export function helpFooter(locale: Locale, prefix: string): string {
  return truncate(msg(locale, "help.footer", { prefix }), FOOTER_MAX);
}

export function commandLine(entry: HelpEntry, locale: Locale): string {
  const base = entry.description
    ? msg(locale, "help.command_line", { usage: entry.usage, description: entry.description })
    : `\`${entry.usage}\``;
  return entry.ownerOnly ? `${base} ${emoji("lock")}` : base;
}

/** Cria botoes de acao rapida para o catalogo web, simuladores, guia e convite do bot. */
export function helpButtonsRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
  const isPt = locale === "pt-BR";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(isPt ? "Catálogo (7.379 Cartas)" : "Catalog (7,379 Cards)")
      .setStyle(ButtonStyle.Link)
      .setURL(KOGU_PORTAL_URL)
      .setEmoji("🌐"),
    new ButtonBuilder()
      .setLabel(isPt ? "Simulador Torre" : "Tower Simulator")
      .setStyle(ButtonStyle.Link)
      .setURL("https://yo-apollon.github.io/kogu/#viewBtn-tower")
      .setEmoji("🗼"),
    new ButtonBuilder()
      .setLabel(isPt ? "Guia & Comandos" : "Guide & Commands")
      .setStyle(ButtonStyle.Link)
      .setURL("https://yo-apollon.github.io/kogu/#viewBtn-commands")
      .setEmoji("📖"),
    new ButtonBuilder()
      .setLabel(isPt ? "Convidar Kogu" : "Invite Kogu")
      .setStyle(ButtonStyle.Link)
      .setURL(KOGU_INVITE_URL)
      .setEmoji("⚡")
  );
}

/** Junta linhas em blocos que cabem na descricao de um embed. */
export function chunkLines(lines: readonly string[], limit = EMBED_DESCRIPTION_SOFT_LIMIT): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current === "" ? line : `${current}\n${line}`;
    if (next.length > limit && current !== "") {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

export function overviewEmbed(groups: readonly HelpGroup[], locale: Locale, prefix: string): EmbedBuilder {
  const isPt = locale === "pt-BR";
  const intro = isPt
    ? `### 🌌 Bem-vindo ao Multiverso Kogu!\n` +
      `Explore mais de **7.379 cartas ativas**, colecione heróis, vilões e lendas de **Animes, Games, Séries, Filmes, Esportes e Música**, dispute o ranking global do Panteão e vença as 12 Amarras da **Torre de Éter**!\n\n` +
      `> 💡 **Guia Rápido:** ${msg(locale, "help.overview")}\n` +
      `> 🌐 **Catálogo & Simuladores:** [yo-apollon.github.io/kogu](${KOGU_PORTAL_URL})\n` +
      `> Navegue pelo menu interativo abaixo ou acesse os links oficiais:`
    : `### 🌌 Welcome to the Kogu Multiverse!\n` +
      `Explore over **7,379 active cards**, collect heroes, villains and legends across **Anime, Gaming, Cinema, Sports and Music**, climb the Pantheon global rankings, and conquer the 12 floors of the **Aether Tower**!\n\n` +
      `> 💡 **Quick Guide:** ${msg(locale, "help.overview")}\n` +
      `> 🌐 **Web Catalog & Simulators:** [yo-apollon.github.io/kogu](${KOGU_PORTAL_URL})\n` +
      `> Browse categories via the interactive menu below or click official links:`;

  const embed = baseEmbed({
    title: msg(locale, "help.title"),
    description: intro,
    color: 0x7c3aed,
    thumbnail: KOGU_AVATAR_URL,
    footer: helpFooter(locale, prefix),
  });

  for (const g of groups) {
    const highlights = g.entries
      .slice(0, 4)
      .map((e) => `\`${prefix}${e.name}\``)
      .join(" • ");
    const countLabel = msg(locale, "help.commands_count", { count: g.entries.length });
    embed.addFields({
      name: `${g.title} (${countLabel})`,
      value: highlights.length > 0 ? `${highlights}\n*(Selecione no menu para ver todos)*` : `*${countLabel}*`,
      inline: true,
    });
  }

  return embed;
}

interface CategoryGuide {
  part1: string;
  part2: string;
  part3: string;
}

function getCategoryGuides(category: string, locale: Locale, prefix: string): CategoryGuide | null {
  const isPt = locale === "pt-BR";

  if (category === "summon") {
    return isPt
      ? {
          part1:
            `### 🌌 Invocação Multiversal (Gacha RPG)\n` +
            `O Kogu possui um acervo colossal com mais de **7.379 cartas ativas** divididas entre Animes, Games, Filmes, Séries, Esportes e Música!\n\n` +
            `### 🎲 Comandos de Rolagem & Sufixos de Universo\n` +
            `> • **\`${prefix}w\`** (\`${prefix}wa\`, \`${prefix}wg\`, \`${prefix}wc\`, \`${prefix}we\`) — Invoca waifus (feminino).\n` +
            `> • **\`${prefix}h\`** (\`${prefix}ha\`, \`${prefix}hg\`, \`${prefix}hc\`, \`${prefix}he\`) — Invoca husbands (masculino).\n` +
            `> • **\`${prefix}m\`** (\`${prefix}mx\`, \`${prefix}ma\`, \`${prefix}mg\`, \`${prefix}mc\`, \`${prefix}me\`) — Invocação mista (qualquer gênero).\n` +
            `> • **\`${prefix}roll\`** (\`${prefix}s\`, \`/roll\`) — Invocação aleatória geral de todo o catálogo.\n` +
            `> • **\`${prefix}ar\`** — Forja armas místicas e artefatos de combate para o RPG.\n\n` +
            `### 🏷️ Filtros de Nicho por Sufixo\n` +
            `> • **\`a\` (Anime & Mangá):** \`${prefix}wa\` • \`${prefix}ha\` • \`${prefix}ma\`\n` +
            `> • **\`g\` (Games):** \`${prefix}wg\` • \`${prefix}hg\` • \`${prefix}mg\`\n` +
            `> • **\`c\` (Cinema & Séries):** \`${prefix}wc\` • \`${prefix}hc\` • \`${prefix}mc\`\n` +
            `> • **\`e\` (Esportes & Música):** \`${prefix}we\` • \`${prefix}he\` • \`${prefix}me\` (UFC, Futebol, NBA, Trap)\n\n` +
            `💡 **Regra de Estoque:** Seus rolls recarregam no minuto \`:00\` de cada hora. Digite \`${prefix}tu\` para consultar.`,
          part2:
            `### 💍 Mecânica de Pacto (Claim) & Temporizadores\n` +
            `Colecione cartas para o seu Panteão e colha recursos cósmicos!\n\n` +
            `### ⏱️ Como Reivindicar & Janela de Proteção\n` +
            `> • **Reação do Anel (💍) ou \`${prefix}claim\`:** Reivindica a carta na tela para o seu Panteão.\n` +
            `> • **Proteção Exclusiva de 30 Segundos:** Durante 30s após o roll, **somente quem invocou** pode dar claim! Após 30s, a carta fica livre para qualquer membro pegar.\n` +
            `> • **Tempo de Espera de Pacto:** 1 pacto a cada **3 horas** (tempo base padrão).\n` +
            `> • **\`${prefix}tu\` (\`${prefix}timers\`):** Painel mestre de temporizadores (Rolls, Pacto, Orbe e Diário).\n\n` +
            `### ⚡ Pactos Especiais & Aceleradores\n` +
            `> • **\`${prefix}fc\` (\`${prefix}freeclaim\`):** Permite firmar um pacto extra imediatamente sem esperar o timer de 3h! (Obtenha em \`${prefix}tuto\`, eventos e votos).\n` +
            `> • **\`${prefix}rt\` (\`${prefix}resettime\`):** Zera a recarga de pacto consumindo o poder da Relíquia de Esmeralda (cooldown de 20h).\n\n` +
            `### 💠 Orbes de Éter (Kakera Orbs)\n` +
            `Quando alguém invoca uma carta que já pertence a outro invocador, um Orbe de Éter se manifesta! Reaja rapidamente para absorver:\n` +
            `> 🔵 **Ciano:** 20~40 | 🟢 **Verde:** 60~100 | 🟡 **Dourado:** 150~250\n` +
            `> 🟠 **Laranja:** 350~500 | 🔴 **Rubi:** 600~900 | 🟣 **Astral:** 1.000~2.500+ Éter!`,
          part3:
            `### 🎯 Otimização de Roster: Desativação & Wishlist\n` +
            `Aumente drasticamente a chance de tirar os seus personagens favoritos!\n\n` +
            `### 🚫 Desativação de Séries (Disable List)\n` +
            `Elimine franquias que você não gosta para não gastar seus rolls à toa:\n` +
            `> • **\`${prefix}disable <série>\` (\`${prefix}d\`):** Bloqueia uma série inteira das suas rolagens.\n` +
            `> • **\`${prefix}antidisable <série>\` (\`${prefix}e\`):** Reativa uma série previamente desativada.\n` +
            `> • **\`${prefix}dl\` (\`${prefix}disablelist\`):** Lista todas as suas séries desativadas e o total de cartas removidas.\n\n` +
            `### 🌠 Lista de Desejos & Notificações\n` +
            `> • **\`${prefix}wish <nome>\` (\`${prefix}w\`):** Adiciona à sua Wishlist. Se alguém rolar seu desejo no servidor, você é marcado com \`@ping\`!\n` +
            `> • **\`${prefix}starwish <nome>\` (\`${prefix}sw\`):** Define seu **Desejo Estelar**: ganhe **+50% de chance de spawn** nas suas próprias rolagens e moldura dourada brilhante!\n` +
            `> • **\`${prefix}wl\`:** Exibe sua lista de desejos ativa.\n\n` +
            `🌐 **Catálogo Completo Online (7.379 Cartas & Simulador Web):**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        }
      : {
          part1:
            `### 🌌 Multiverse Summoning (Gacha RPG)\n` +
            `Kogu features a colossal roster of over **7,379 active cards** across Anime, Gaming, Cinema, Sports, and Music!\n\n` +
            `### 🎲 Summon Commands & Universe Suffixes\n` +
            `> • **\`${prefix}w\`** (\`${prefix}wa\`, \`${prefix}wg\`, \`${prefix}wc\`, \`${prefix}we\`) — Summons waifus (female characters).\n` +
            `> • **\`${prefix}h\`** (\`${prefix}ha\`, \`${prefix}hg\`, \`${prefix}hc\`, \`${prefix}he\`) — Summons husbands (male characters).\n` +
            `> • **\`${prefix}m\`** (\`${prefix}mx\`, \`${prefix}ma\`, \`${prefix}mg\`, \`${prefix}mc\`, \`${prefix}me\`) — Mixed summon (any gender).\n` +
            `> • **\`${prefix}roll\`** (\`${prefix}s\`, \`/roll\`) — General random summon across the entire multiverse.\n` +
            `> • **\`${prefix}ar\`** — Forges mythical weapons and combat artifacts for RPG battles.\n\n` +
            `### 🏷️ Category Filters by Suffix\n` +
            `> • **\`a\` (Anime & Manga):** \`${prefix}wa\` • \`${prefix}ha\` • \`${prefix}ma\`\n` +
            `> • **\`g\` (Games):** \`${prefix}wg\` • \`${prefix}hg\` • \`${prefix}mg\`\n` +
            `> • **\`c\` (Cinema & TV):** \`${prefix}wc\` • \`${prefix}hc\` • \`${prefix}mc\`\n` +
            `> • **\`e\` (Sports & Music):** \`${prefix}we\` • \`${prefix}he\` • \`${prefix}me\` (UFC, Football, NBA, Trap)\n\n` +
            `💡 **Stock Rule:** Rolls reset at \`:00\` every hour. Type \`${prefix}tu\` to check your available rolls.`,
          part2:
            `### 💍 Pact System (Claim), Protection & Orbs\n` +
            `Collect cards for your Pantheon and harvest cosmic resources!\n\n` +
            `### ⏱️ How to Claim & Protection Window\n` +
            `> • **Ring Reaction (💍) or \`${prefix}claim\`:** Claims the rolled character for your Pantheon.\n` +
            `> • **Exclusive 30s Protection:** For the first 30s after rolling, **only the roller** can claim! Afterwards, any server member can claim.\n` +
            `> • **Pact Cooldown:** 1 pact every **3 hours** (default server setting).\n` +
            `> • **\`${prefix}tu\` (\`${prefix}timers\`):** Master timers panel (Rolls, Claim, Daily, and Orbs).\n\n` +
            `### ⚡ Special Pacts & Accelerators\n` +
            `> • **\`${prefix}fc\` (\`${prefix}freeclaim\`):** Allows an instant bonus claim without waiting for the 3h cooldown!\n` +
            `> • **\`${prefix}rt\` (\`${prefix}resettime\`):** Resets your pact cooldown using the Emerald Relic (20h cooldown).\n\n` +
            `### 💠 Aether Orbs (Kakera Orbs)\n` +
            `When someone rolls a card already claimed by another player, an Aether Orb appears! React quickly to absorb:\n` +
            `> 🔵 **Cyan:** 20~40 | 🟢 **Green:** 60~100 | 🟡 **Gold:** 150~250\n` +
            `> 🟠 **Orange:** 350~500 | 🔴 **Ruby:** 600~900 | 🟣 **Astral:** 1,000~2,500+ Aether!`,
          part3:
            `### 🎯 Roster Optimization: Disables & Wishlist\n` +
            `Drastically increase your chances of rolling your favorite characters!\n\n` +
            `### 🚫 Disable List\n` +
            `Filter out franchises you don't want so you never waste rolls:\n` +
            `> • **\`${prefix}disable <series>\` (\`${prefix}d\`):** Disables an entire franchise from your personal rolls.\n` +
            `> • **\`${prefix}antidisable <series>\` (\`${prefix}e\`):** Re-enables a disabled franchise.\n` +
            `> • **\`${prefix}dl\` (\`${prefix}disablelist\`):** Lists all your disabled series and filtered card count.\n\n` +
            `### 🌠 Wishlist & Starwish\n` +
            `> • **\`${prefix}wish <name>\` (\`${prefix}w\`):** Adds a character to your Wishlist. You receive a \`@ping\` when rolled!\n` +
            `> • **\`${prefix}starwish <name>\` (\`${prefix}sw\`):** Sets your **Starwish**: grants **+50% spawn chance** on your own rolls and golden frame!\n` +
            `> • **\`${prefix}wl\`:** Displays your active wishlist.\n\n` +
            `🌐 **Complete Online Catalog (7,379 Cards & Web Simulator):**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        };
  }

  if (category === "collection") {
    return isPt
      ? {
          part1:
            `### 🏛️ Gestão do Panteão & Exibição de Cartas\n` +
            `Seu Panteão é a morada de todas as almas e entidades que você conquistou no multiverso!\n\n` +
            `### 📜 Comandos de Visualização\n` +
            `> • **\`${prefix}pt\` (\`${prefix}panteon\`, \`${prefix}mm\`):** Exibe seu Panteão completo com fotos e navegação rápida.\n` +
            `> • **\`${prefix}pt @usuário\`:** Inspeciona o Panteão e a coleção de outro jogador no servidor.\n` +
            `> • **\`${prefix}im <nome>\` (\`${prefix}info\`):** Ficha técnica detalhada da carta: foto oficial, raridade, valor de Éter, ranking de popularidade, Selos de Despertar e status de combate (ATK, DEF, SPD, HP).\n` +
            `> • **\`${prefix}pr\` (\`${prefix}profile\`):** Abre seu Perfil Dimensional com conquistas, saldo de Éter, insígnias e nível da Torre.\n` +
            `> • **\`${prefix}sm <critério>\`:** Ordena seu Panteão (\`val\` = valor, \`claim\` = data de captura, \`rarity\` = raridade, \`alpha\` = alfabética, \`series\` = por franquia).`,
          part2:
            `### 🎨 Customização Visual & Selos de Poder\n` +
            `Personalize suas cartas favoritas e liberte todo o seu potencial de combate!\n\n` +
            `### ✨ Personalização de Cartas\n` +
            `> • **\`${prefix}firstmarry <nome>\` (\`${prefix}fm\`):** Consagra o Líder / Favorito Supremo do seu Panteão! Aparece no perfil, nos seus rolls e nas vitórias de arena.\n` +
            `> • **\`${prefix}custompic <nome> <url>\` (\`${prefix}ci\`):** Define uma imagem ou GIF personalizado exclusivo para a sua carta.\n` +
            `> • **\`${prefix}alias <nome> <apelido>\`:** Define um apelido customizado para o personagem.\n` +
            `> • **\`${prefix}note <nome> <texto>\`:** Grava uma mensagem personalizada visível na ficha da carta.\n\n` +
            `### 🔑 Selos de Despertar (Keys System)\n` +
            `Quando você ou outro jogador rola um personagem que você já possui e o orbe é absorvido, sua carta ganha **Selos de Despertar (Chaves)**:\n` +
            `> • **Chave 1:** Borda aprimorada e +5% em todos os status de combate (RPG).\n` +
            `> • **Chave 2:** Ganho passivo aumentado de Éter diário no \`${prefix}daily\`.\n` +
            `> • **Chave 3:** Desbloqueio da habilidade mística especial na Arena Dimensional.\n` +
            `> • **Chave 4+:** Aura astral cintilante e status lendários de prestígio!\n` +
            `> • **\`${prefix}infokeys\`:** Tabela completa de marcos de despertar.`,
          part3:
            `### 🤝 Trocas, Presentes & Dissolução\n` +
            `Interaja com o mercado do servidor e faça sua coleção prosperar!\n\n` +
            `### 🔄 Mercado Entre Jogadores\n` +
            `> • **\`${prefix}trade @usuário\`:** Inicia uma sessão de troca bilateral segura com confirmação dupla (até 5 cartas por lado).\n` +
            `> • **\`${prefix}give @usuário <nome>\`:** Presenteia uma carta do seu Panteão diretamente para um amigo.\n` +
            `> • **\`${prefix}dissolve <nome>\` (\`${prefix}dk\`):** Dissolve o pacto com uma entidade, liberando-a para o multiverso e recebendo o valor total em Éter puro!\n\n` +
            `### 🏆 Rankings Globais\n` +
            `> • **\`${prefix}top\` / \`${prefix}topserv\`:** Exibe o Hall da Fama do servidor — maiores fortunas de Éter e maiores Panteões!\n\n` +
            `🌐 **Simule o Combate das suas Cartas:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        }
      : {
          part1:
            `### 🏛️ Pantheon Management & Card Inspection\n` +
            `Your Pantheon houses all the souls and legends you have conquered in the multiverse!\n\n` +
            `### 📜 Viewing Commands\n` +
            `> • **\`${prefix}pt\` (\`${prefix}panteon\`, \`${prefix}mm\`):** Displays your complete Pantheon with fast pagination.\n` +
            `> • **\`${prefix}pt @user\`:** Inspects another player's Pantheon and relics.\n` +
            `> • **\`${prefix}im <name>\` (\`${prefix}info\`):** Detailed card sheet: official art, rarity, Aether value, popularity rank, Awakening Seals, and RPG combat stats (ATK, DEF, SPD, HP).\n` +
            `> • **\`${prefix}pr\` (\`${prefix}profile\`):** Opens your Dimensional Profile with achievements, Aether balance, badges, and Tower level.\n` +
            `> • **\`${prefix}sm <criteria>\`:** Permanent sorting for your Pantheon (\`val\` = value, \`claim\` = capture date, \`rarity\` = rarity, \`alpha\` = alphabetical, \`series\` = franchise).`,
          part2:
            `### 🎨 Visual Customization & Awakening Seals\n` +
            `Customize your favorite cards and unleash their true combat potential!\n\n` +
            `### ✨ Card Personalization\n` +
            `> • **\`${prefix}firstmarry <name>\` (\`${prefix}fm\`):** Crowns your Supreme Pantheon Leader! Displayed on profile, summons, and arena victories.\n` +
            `> • **\`${prefix}custompic <name> <url>\` (\`${prefix}ci\`):** Sets an external custom picture or GIF for your card.\n` +
            `> • **\`${prefix}alias <name> <nickname>\`:** Sets a custom nickname for the character.\n` +
            `> • **\`${prefix}note <name> <text>\`:** Embeds a personal message on the card sheet.\n\n` +
            `### 🔑 Awakening Seals (Keys System)\n` +
            `When you or another player rolls a character you already own and the orb is absorbed, your card earns **Awakening Keys**:\n` +
            `> • **Key 1:** Upgraded border and +5% across all combat stats (RPG).\n` +
            `> • **Key 2:** Increased passive daily Aether gain in \`${prefix}daily\`.\n` +
            `> • **Key 3:** Unlocks the unique mystical perk in the Dimensional Arena.\n` +
            `> • **Key 4+:** Gleaming astral aura and legendary prestige status!\n` +
            `> • **\`${prefix}infokeys\`:** Complete table of awakening milestones.`,
          part3:
            `### 🤝 Trading, Gifting & Dissolution\n` +
            `Interact with the server marketplace and optimize your cosmic resources!\n\n` +
            `### 🔄 Marketplace Transactions\n` +
            `> • **\`${prefix}trade @user\`:** Starts a secure two-way trade session with double confirmation (up to 5 cards per side).\n` +
            `> • **\`${prefix}give @user <name>\`:** Gifts a card from your Pantheon directly to a friend.\n` +
            `> • **\`${prefix}dissolve <name>\` (\`${prefix}dk\`):** Dissolves a pact, releasing the card to the multiverse and refunding full Aether!\n\n` +
            `### 🏆 Server Leaderboards\n` +
            `> • **\`${prefix}top\` / \`${prefix}topserv\`:** Displays the server Hall of Fame — wealthiest in Aether and biggest Pantheons!\n\n` +
            `🌐 **Simulate RPG Card Battles Online:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        };
  }

  if (category === "economy") {
    return isPt
      ? {
          part1:
            `### 💠 Economia Dimensional de Éter\n` +
            `O Éter é a energia mágica universal usada para forjar andares da Torre, abrir baús cósmicos e apostar no Cassino!\n\n` +
            `### 💰 Fontes de Recursos & Relíquias\n` +
            `> • **\`${prefix}daily\`:** Resgata seu salário diário de Éter e rolagens bônus (reseta a cada 20h).\n` +
            `> • **\`${prefix}givekakera @usuário <valor>\`:** Transfere Éter do seu saldo para outro jogador no servidor.\n` +
            `> • **\`${prefix}kl\` (\`${prefix}lootbox\`):** Abre uma Caixa Astral consumindo Éter em troca de rolls temporários, chaves e relíquias raras.\n` +
            `> • **\`${prefix}relics\`:** Painel de Relíquias de Poder (Esmeralda, Rubi, Safira, etc.), concedendo reduções permanentes de cooldown!`,
          part2:
            `### 🎰 Cassino Astral & Minigames de Apostas\n` +
            `Arrisque seu Éter em jogos dinâmicos e multiplique sua fortuna!\n\n` +
            `### 🎲 Jogos Disponíveis\n` +
            `> • **\`${prefix}blackjack <aposta>\` (\`${prefix}bj\`):** Jogue 21 contra a banca! Compre cartas (\`Hit\`), pare (\`Stand\`) ou dobre (\`Double\`). Blackjack paga 2.5x!\n` +
            `> • **\`${prefix}slot <aposta>\`:** Máquina de Caça-Níqueis de Familiares. Combine 3 criaturas iguais para ganhar jackpots de até 10x!\n` +
            `> • **\`${prefix}coinflip <cara/coroa> <aposta>\` (\`${prefix}cf\`):** Cara ou coroa clássico valendo o dobro ou nada (50% de chance exata).\n` +
            `> • **\`${prefix}arena\` (\`${prefix}duel\`):** Convoque seu campeão mais forte para a Arena RPG. Seus atributos de combate (ATK, DEF, SPD, HP) decidem o duelo!\n` +
            `> • **\`${prefix}blacktea\`:** Batalha veloz de vocabulário contra os amigos pelo pote de Éter acumulado.\n` +
            `> • **\`${prefix}quiz\`:** Responda perguntas sobre cultura pop, animes e games valendo prêmios imediatos.`,
          part3:
            `### 🗼 A Torre de Éter (Obelisco de 12 Andares)\n` +
            `A maior conquista do jogador dedicado! Cada andar erguido confere poderes passivos permanentes para a sua conta!\n\n` +
            `### 🔨 Comandos da Torre\n` +
            `> • **\`${prefix}ktower\`:** Exibe a estrutura da sua Torre e as vantagens de cada andar.\n` +
            `> • **\`${prefix}build\`:** Constrói o próximo andar consumindo Éter:\n` +
            `>   - 🔹 **Andar 1-3:** +Rolls por hora e redução de recarga na absorção de orbes.\n` +
            `>   - 🔹 **Andar 4-6:** +Valor ao coletar Éter e +Slots extras na Wishlist.\n` +
            `>   - 🔹 **Andar 7-9:** Aumento na probabilidade de cartas Épicas e Míticas nas rolagens.\n` +
            `>   - 🔹 **Andar 10-12:** Redução no cooldown de pacto e auto-claim em Desejos Estelares!\n` +
            `> • **\`${prefix}destroy\`:** Demole a torre e **reembolsa 100% de todo o Éter investido** a qualquer momento, sem penalidades!\n\n` +
            `🌐 **Simulador Interativo da Torre de Éter Online:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/#viewBtn-tower**`,
        }
      : {
          part1:
            `### 💠 Dimensional Aether Economy\n` +
            `Aether is the universal cosmic currency used to forge Tower floors, unlock Astral Chests, and bet in the Casino!\n\n` +
            `### 💰 Resources & Relics\n` +
            `> • **\`${prefix}daily\`:** Claims your daily Aether stipend and bonus rolls (resets every 20h).\n` +
            `> • **\`${prefix}givekakera @user <amount>\`:** Transfers Aether from your balance to another player.\n` +
            `> • **\`${prefix}kl\` (\`${prefix}lootbox\`):** Opens an Astral Chest for temporary rolls, keys, and relics.\n` +
            `> • **\`${prefix}relics\`:** Relics panel (Emerald, Ruby, Sapphire, etc.) providing permanent cooldown reductions!`,
          part2:
            `### 🎰 Astral Casino & Betting Minigames\n` +
            `Wager your Aether in interactive games and multiply your fortune!\n\n` +
            `### 🎲 Available Games\n` +
            `> • **\`${prefix}blackjack <bet>\` (\`${prefix}bj\`):** Play 21 against the dealer! Hit, Stand, or Double. Natural Blackjack pays 2.5x!\n` +
            `> • **\`${prefix}slot <bet>\`:** Familiar Slot Machine. Match 3 identical beasts for jackpots up to 10x!\n` +
            `> • **\`${prefix}coinflip <heads/tails> <bet>\` (\`${prefix}cf\`):** Classic coin toss for double or nothing (exact 50% chance).\n` +
            `> • **\`${prefix}arena\` (\`${prefix}duel\`):** Summon your champion to the RPG Arena. Combat attributes (ATK, DEF, SPD, HP) decide the duel!\n` +
            `> • **\`${prefix}blacktea\`:** Fast-paced vocabulary battle against friends for the accumulated pot.\n` +
            `> • **\`${prefix}quiz\`:** Answer trivia questions about anime, gaming, and sports for instant rewards.`,
          part3:
            `### 🗼 The Aether Tower (12-Floor Obelisk)\n` +
            `The ultimate milestone! Each floor built grants permanent passive perks for your account!\n\n` +
            `### 🔨 Tower Commands\n` +
            `> • **\`${prefix}ktower\`:** Displays your Tower blueprint and floor benefits.\n` +
            `> • **\`${prefix}build\`:** Builds the next floor using Aether:\n` +
            `>   - 🔹 **Floors 1-3:** +Rolls per hour and faster orb absorption cooldown.\n` +
            `>   - 🔹 **Floors 4-6:** +Aether per orb and extra Wishlist slots.\n` +
            `>   - 🔹 **Floors 7-9:** Boosted spawn rates for Epic and Mythic cards.\n` +
            `>   - 🔹 **Floors 10-12:** Reduced pact cooldown and auto-claim on Starwishes!\n` +
            `> • **\`${prefix}destroy\`:** Demolishes the tower and **refunds 100% of invested Aether** at any time with zero penalty!\n\n` +
            `🌐 **Interactive Web Tower Simulator:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/#viewBtn-tower**`,
        };
  }

  if (category === "wishlist") {
    return isPt
      ? {
          part1:
            `### 🌠 Sistema Dimensional de Desejos (Wishlist)\n` +
            `Marque suas cartas dos sonhos para não perder nenhuma oportunidade de claim quando surgirem no chat!\n\n` +
            `### 📝 Comandos da Lista\n` +
            `> • **\`${prefix}wish <nome>\` (\`${prefix}w\`):** Adiciona ou remove uma entidade da sua Wishlist.\n` +
            `> • **\`${prefix}wishlist\` (\`${prefix}wl\`):** Exibe sua lista completa com fotos, status de captura e paginação.\n` +
            `> • **\`${prefix}wishseries <série>\`:** Adiciona todos os personagens de uma determinada obra à sua lista de uma vez!\n\n` +
            `### 🔔 Notificações & Pings Automáticos\n` +
            `Sempre que qualquer membro do servidor invocar uma carta que está na sua Wishlist, o Kogu marca você com um **\`@ping\` imediato** no chat e o embed brilha em destaque azul astral!`,
          part2:
            `### ⭐ O Desejo Estelar (Starwish)\n` +
            `Consagre sua carta favorita suprema como o seu **Desejo Estelar**!\n\n` +
            `### 🌟 Super Vantagens do Starwish\n` +
            `> • **\`${prefix}starwish <nome>\` (\`${prefix}sw\`):** Define seu Desejo Estelar ativo.\n` +
            `> • ⭐ **+50% de Taxa de Aparição:** Aumento expressivo de probabilidade de a carta aparecer nas suas próprias invocações!\n` +
            `> • ✨ **Moldura Dourada Cintilante:** O embed da carta surge com estética especial dourada e celebração astral no servidor!\n` +
            `> • 🛡️ **Proteção Absoluta de 30 Segundos:** Garante tempo total para você firmar o pacto antes de qualquer outro jogador.`,
          part3:
            `### 💡 Dicas de Estratégia de Desejo\n` +
            `> • Construa andares na Torre de Éter (\`${prefix}ktower\`) para desbloquear mais slots de Wishlist.\n` +
            `> • Combine sua Wishlist com a desativação de séries irrelevantes (\`${prefix}disable\`) para focar os rolls exclusivamente nos seus favoritos.\n\n` +
            `🌐 **Encontre os Personagens Mais Raros no Catálogo Online:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        }
      : {
          part1:
            `### 🌠 Wishlist System & Roll Alerts\n` +
            `Track your dream cards so you never miss an opportunity to claim them when rolled!\n\n` +
            `### 📝 Wishlist Commands\n` +
            `> • **\`${prefix}wish <name>\` (\`${prefix}w\`):** Adds or removes a character from your Wishlist.\n` +
            `> • **\`${prefix}wishlist\` (\`${prefix}wl\`):** Displays your complete wishlist with pagination and claim status.\n` +
            `> • **\`${prefix}wishseries <series>\`:** Adds all characters from a franchise at once!\n\n` +
            `### 🔔 Automated Pings\n` +
            `Whenever any server member summons a card from your Wishlist, Kogu instantly marks you with an **\`@ping\`** and highlights the embed in astral cyan!`,
          part2:
            `### ⭐ The Starwish System\n` +
            `Crown your #1 most coveted character as your **Starwish**!\n\n` +
            `### 🌟 Starwish Perks\n` +
            `> • **\`${prefix}starwish <name>\` (\`${prefix}sw\`):** Sets your active Starwish.\n` +
            `> • ⭐ **+50% Spawn Rate:** Massive probability boost on your personal rolls!\n` +
            `> • ✨ **Gleaming Gold Frame:** The card embed appears with a unique golden theme.\n` +
            `> • 🛡️ **Full 30s Protection:** Guaranteed exclusive claim window.`,
          part3:
            `### 💡 Wishlist Pro Tips\n` +
            `> • Build floors in the Aether Tower (\`${prefix}ktower\`) to unlock extra Wishlist slots.\n` +
            `> • Pair your Wishlist with series disables (\`${prefix}disable\`) to focus rolls entirely on your favorites.\n\n` +
            `🌐 **Discover the Rarest Cards in the Online Catalog:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        };
  }

  if (category === "config") {
    return isPt
      ? {
          part1:
            `### ⚙️ Configurações & Personalização do Servidor\n` +
            `Ajuste as regras de jogo, timers e idioma para criar a melhor experiência na sua comunidade!\n\n` +
            `### 🛠️ Comandos de Configuração\n` +
            `> • **\`${prefix}settings\`:** Painel interativo com todas as configurações ativas do servidor.\n` +
            `> • **\`${prefix}prefix <símbolo>\`:** Altera o prefixo de comandos no servidor (ex: \`$\`, \`!\`, \`.\`, \`k!\`).\n` +
            `> • **\`${prefix}lang <pt-BR | en-US>\`:** Altera o idioma oficial do bot entre Português e Inglês.\n` +
            `> • **\`${prefix}gamemode <1 | 2>\`:** Alterna entre Modo Casual (1) e Modo Competitivo (2).`,
          part2:
            `### ⏱️ Ajuste de Rolagens, Cooldowns & Desativação Global\n` +
            `Personalize o ritmo de jogo do seu servidor com comandos intuitivos:\n\n` +
            `### ⚙️ Parâmetros Disponíveis\n` +
            `> • **\`${prefix}setrolls <quantidade>\`:** Define o limite de invocações por hora para cada jogador (padrão: 10).\n` +
            `> • **\`${prefix}settimer <minutos>\`:** Define o intervalo de recarga entre cada pacto (padrão: 180 min / 3 horas).\n` +
            `> • **\`${prefix}setclaim <segundos>\`:** Ajusta a duração da janela de proteção exclusiva de quem invocou (padrão: 30s).`,
          part3:
            `### 🚫 Desativação Global de Séries\n` +
            `> • **\`${prefix}disable <série>\`:** Remove uma série inteira das invocações de todo o servidor.\n` +
            `> • **\`${prefix}antidisable <série>\`:** Reabilita a série nas invocações.\n` +
            `> • **\`${prefix}disablelist\` (\`${prefix}dl\`):** Lista todas as séries bloqueadas no servidor.\n\n` +
            `🌐 **Guia Completo de Administração na Web:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/#viewBtn-commands**`,
        }
      : {
          part1:
            `### ⚙️ Server Configuration & Customization\n` +
            `Fine-tune gameplay rules, timers, and language for your community!\n\n` +
            `### 🛠️ Configuration Commands\n` +
            `> • **\`${prefix}settings\`:** Interactive panel with all active server settings.\n` +
            `> • **\`${prefix}prefix <symbol>\`:** Changes the bot command prefix (e.g. \`$\`, \`!\`, \`.\`, \`k!\`).\n` +
            `> • **\`${prefix}lang <pt-BR | en-US>\`:** Sets the server language between Portuguese and English.\n` +
            `> • **\`${prefix}gamemode <1 | 2>\`:** Toggles between Casual Mode (1) and Competitive Mode (2).`,
          part2:
            `### ⏱️ Rolls, Cooldowns & Claim Adjustments\n` +
            `Control the pace of your game with intuitive commands:\n\n` +
            `### ⚙️ Parameters\n` +
            `> • **\`${prefix}setrolls <amount>\`:** Sets maximum rolls per hour per player (default: 10).\n` +
            `> • **\`${prefix}settimer <minutes>\`:** Sets cooldown between pacts (default: 180 min / 3 hours).\n` +
            `> • **\`${prefix}setclaim <seconds>\`:** Adjusts the roller's exclusive claim protection window (default: 30s).`,
          part3:
            `### 🚫 Server-wide Series Disables\n` +
            `> • **\`${prefix}disable <series>\`:** Blocks an entire series from spawning server-wide.\n` +
            `> • **\`${prefix}antidisable <series>\`:** Re-enables a blocked series.\n` +
            `> • **\`${prefix}disablelist\` (\`${prefix}dl\`):** Lists all server-wide blocked franchises.\n\n` +
            `🌐 **Complete Admin Guide Online:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/#viewBtn-commands**`,
        };
  }

  if (category === "catalog") {
    return isPt
      ? {
          part1:
            `### 📚 Catálogo do Multiverso Kogu (7.379 Cartas Ativas)\n` +
            `O acervo do Kogu é o maior e mais diversificado entre todos os bots de cultura pop e gacha!\n\n` +
            `### 🌟 Categorias em Destaque\n` +
            `> • 🥊 **UFC & MMA:** 103 cartas (Alex Poatan, Jon Jones, Conor McGregor, Charles do Bronx...)\n` +
            `> • ⚽ **Futebol Mundial:** 102 cartas (Cristiano Ronaldo, Messi, Pelé, Neymar, Ronaldo Fenômeno...)\n` +
            `> • 🏀 **NBA / Basquete:** 82 cartas (Michael Jordan, LeBron James, Kobe Bryant, Curry...)\n` +
            `> • 🎤 **Música & Trap:** 151 cartas (Michael Jackson, Freddie Mercury, Travis Scott, Matuê...)\n` +
            `> • 🎌 **Anime & Mangá:** 5.800+ cartas consagradas de todas as eras!\n` +
            `> • 🎮 **Games & Cinema:** Centenas de ícones dos jogos e filmes!`,
          part2:
            `### 🔍 Comandos de Pesquisa & Curadoria\n` +
            `Participe do crescimento contínuo do multiverso do Kogu:\n\n` +
            `### 📋 Comandos Disponíveis\n` +
            `> • **\`${prefix}catalog\`:** Painel de status e estatísticas do catálogo em tempo real.\n` +
            `> • **\`${prefix}suggest <nome | link>\`:** Sugira personagens, idols, atletas ou obras para inclusão.\n` +
            `> • **\`${prefix}suggestlist\`:** Exibe as sugestões pendentes de análise (staff).\n` +
            `> • **\`${prefix}approvesuggest <id>\`:** Aprova e importa a sugestão direto para o banco de dados oficial (staff).`,
          part3:
            `### 💎 Edições Derivadas (Base, Épica, Mítica 1/1)\n` +
            `Personagens lendários possuem edições alternativas raras com artes exclusivas e multiplicadores de Éter!\n\n` +
            `🌐 **Navegue pelo Catálogo Web Completo:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        }
      : {
          part1:
            `### 📚 Kogu Multiverse Catalog (7,379 Active Cards)\n` +
            `Kogu features the largest and most diverse card catalog among pop culture bots!\n\n` +
            `### 🌟 Featured Rosters\n` +
            `> • 🥊 **UFC & MMA:** 103 cards (Alex Pereira, Jon Jones, Conor McGregor, Charles Oliveira...)\n` +
            `> • ⚽ **World Football:** 102 cards (Cristiano Ronaldo, Messi, Pelé, Neymar, R9...)\n` +
            `> • 🏀 **NBA / Basketball:** 82 cards (Michael Jordan, LeBron James, Kobe Bryant, Curry...)\n` +
            `> • 🎤 **Music & Trap:** 151 cards (Michael Jackson, Freddie Mercury, Travis Scott, Drake...)\n` +
            `> • 🎌 **Anime & Manga:** 5,800+ legendary characters from all eras!\n` +
            `> • 🎮 **Gaming & Cinema:** Hundreds of gaming and movie icons!`,
          part2:
            `### 🔍 Search & Curation Commands\n` +
            `Contribute to the continuous growth of Kogu's multiverse:\n\n` +
            `### 📋 Available Commands\n` +
            `> • **\`${prefix}catalog\`:** Real-time catalog status and metrics panel.\n` +
            `> • **\`${prefix}suggest <name | url>\`:** Suggest characters, idols, athletes, or media for inclusion.\n` +
            `> • **\`${prefix}suggestlist\`:** Displays pending suggestions awaiting review (staff).\n` +
            `> • **\`${prefix}approvesuggest <id>\`:** Approves and imports the suggestion directly into the official database (staff).`,
          part3:
            `### 💎 Derived Editions (Base, Epic, Mythic 1/1)\n` +
            `Legendary figures feature rare alternative editions with exclusive portraits and Aether multipliers!\n\n` +
            `🌐 **Browse the Complete Web Catalog:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        };
  }

  if (category === "admin") {
    return isPt
      ? {
          part1:
            `### 🛡️ Moderação & Gestão Staff\n` +
            `Comandos restritos à equipe de moderação e ao dono do bot para manter a integridade do jogo.\n\n` +
            `### 🔨 Comandos de Manutenção\n` +
            `> • **\`${prefix}cleanuser @usuário\`:** Libera todos os pactos de um usuário que saiu ou foi banido, devolvendo as cartas ao multiverso.\n` +
            `> • **\`${prefix}thanos\`:** O estalo místico: dissolve com segurança metade das cartas sem Selos de membros inativos para reoxigenar o mercado do servidor.`,
          part2:
            `### ⚙️ Permissões & Status\n` +
            `> • **\`${prefix}setvip @usuário <nível>\`:** Define o nível VIP de um membro, concedendo limites expandidos e cosméticos exclusivos.\n` +
            `> • **\`${prefix}adminreset\`:** Reseta os temporizadores e rolagens para testes e eventos da moderação.\n` +
            `> • **\`${prefix}ping\`:** Monitora a latência em tempo real da conexão com o Discord e o banco de dados.`,
          part3:
            `### 🚀 Infraestrutura & Sentinel 24/7\n` +
            `O bot é monitorado 24 horas por dia por um Sentinel Watchdog na VPS da Oracle Cloud com reinício automático e auto-healing.\n\n` +
            `🌐 **Painel de Controle Web:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        }
      : {
          part1:
            `### 🛡️ Moderation & Staff Controls\n` +
            `Commands restricted to moderation staff and the bot owner to maintain game balance.\n\n` +
            `### 🔨 Maintenance Commands\n` +
            `> • **\`${prefix}cleanuser @user\`:** Releases all pacts of a left or banned user back to the multiverse.\n` +
            `> • **\`${prefix}thanos\`:** The mystic snap: safely dissolves unsealed cards from inactive users to re-oxygenate the marketplace.`,
          part2:
            `### ⚙️ Permissions & Metrics\n` +
            `> • **\`${prefix}setvip @user <level>\`:** Grants VIP tier benefits, expanded limits, and cosmetics.\n` +
            `> • **\`${prefix}adminreset\`:** Resets roll and pact timers for testing and community events.\n` +
            `> • **\`${prefix}ping\`:** Monitors real-time latency to Discord and database.`,
          part3:
            `### 🚀 24/7 Cloud Infrastructure\n` +
            `Monitored 24/7 by an automated Sentinel Watchdog on Oracle Cloud VPS with instant self-healing.\n\n` +
            `🌐 **Web Control Center:**\n` +
            `👉 **https://yo-apollon.github.io/kogu/**`,
        };
  }

  if (category === "help") {
    return isPt
      ? {
          part1:
            `### ❓ Central de Suporte & Guia Oficial\n` +
            `Encontre respostas rápidas para dúvidas sobre o Kogu e seus comandos.\n\n` +
            `### 💡 Dicas de Início Rápido\n` +
            `> • Digite **\`${prefix}tuto\`** para iniciar o tutorial interativo e ganhar **+500 Éter, +5 Rolls e um Pacto Gratuito (\`${prefix}fc\`)**!\n` +
            `> • Digite **\`${prefix}daily\`** todos os dias para acumular Éter e invocações bônus.\n` +
            `> • Digite **\`${prefix}tu\`** para acompanhar seus temporizadores em tempo real.`,
          part2:
            `### ⚡ Atalhos Rápidos Recomendados\n` +
            `> • **\`${prefix}w\`** — Invoca personagens femininas.\n` +
            `> • **\`${prefix}h\`** — Invoca personagens masculinos.\n` +
            `> • **\`${prefix}pt\`** — Abre o seu Panteão.\n` +
            `> • **\`${prefix}ktower\`** — Visualiza sua Torre de Éter.\n` +
            `> • **\`${prefix}invite\`** — Exibe o link de convite oficial.`,
          part3:
            `### 🌐 Links Oficiais & Comunidade\n` +
            `• Catálogo Online com 7.379 cartas: **https://yo-apollon.github.io/kogu/**\n` +
            `• Simulador da Torre de Éter: **https://yo-apollon.github.io/kogu/#viewBtn-tower**\n` +
            `• Convide o Kogu para seu servidor usando o botão abaixo!`,
        }
      : {
          part1:
            `### ❓ Support Hub & Official Guide\n` +
            `Quick answers to questions about Kogu and its commands.\n\n` +
            `### 💡 Starter Tips\n` +
            `> • Type **\`${prefix}tuto\`** to start the interactive tutorial and earn **+500 Aether, +5 Rolls, and a Free Claim (\`${prefix}fc\`)**!\n` +
            `> • Type **\`${prefix}daily\`** every day for Aether and bonus rolls.\n` +
            `> • Type **\`${prefix}tu\`** to track all timers in real-time.`,
          part2:
            `### ⚡ Essential Shortcuts\n` +
            `> • **\`${prefix}w\`** — Summons female characters.\n` +
            `> • **\`${prefix}h\`** — Summons male characters.\n` +
            `> • **\`${prefix}pt\`** — Opens your Pantheon.\n` +
            `> • **\`${prefix}ktower\`** — Displays your Aether Tower.\n` +
            `> • **\`${prefix}invite\`** — Displays the official invite link.`,
          part3:
            `### 🌐 Official Links & Community\n` +
            `• Online Catalog with 7,379 cards: **https://yo-apollon.github.io/kogu/**\n` +
            `• Aether Tower Simulator: **https://yo-apollon.github.io/kogu/#viewBtn-tower**\n` +
            `• Invite Kogu to your server using the button below!`,
        };
  }

  return null;
}

export function categoryEmbeds(group: HelpGroup, locale: Locale, prefix: string): EmbedBuilder[] {
  if (group.entries.length === 0) {
    return [
      baseEmbed({
        title: group.title,
        description: msg(locale, "help.no_commands"),
        color: 0x7c3aed,
        thumbnail: KOGU_AVATAR_URL,
        footer: helpFooter(locale, prefix),
      }),
    ];
  }

  const lines = group.entries.map((e) => {
    const lock = e.ownerOnly ? ` ${emoji("lock")} *(Staff)*` : "";
    const slash = e.slash ? " `[/]`" : "";
    const desc = e.description ? `\n> ${e.description}` : "";
    return `### 🔹 \`${e.usage}\`${slash}${lock}${desc}`;
  });

  // Se o grupo tem MUITOS comandos (ex: 120 sinteticos nos testes), divide estritamente por tamanho
  if (group.entries.length > 25) {
    const chunks = chunkLines(lines).slice(0, MAX_EMBEDS_PER_CATEGORY);
    return chunks.map((chunk, i) =>
      baseEmbed({
        title: i === 0 ? group.title : undefined,
        description: chunk,
        color: 0x7c3aed,
        thumbnail: KOGU_AVATAR_URL,
        footer: helpFooter(locale, prefix),
      })
    );
  }

  const guide = getCategoryGuides(group.category, locale, prefix);
  if (!guide) {
    const chunks = chunkLines(lines).slice(0, MAX_EMBEDS_PER_CATEGORY);
    return chunks.map((chunk, i) =>
      baseEmbed({
        title: i === 0 ? group.title : undefined,
        description: chunk,
        color: 0x7c3aed,
        thumbnail: KOGU_AVATAR_URL,
        footer: helpFooter(locale, prefix),
      })
    );
  }

  // Distribui os comandos registrados entre os 3 embeds ricos
  const n = lines.length;
  const chunk1Count = Math.ceil(n / 3);
  const chunk2Count = Math.ceil((n - chunk1Count) / 2);

  const lines1 = lines.slice(0, chunk1Count);
  const lines2 = lines.slice(chunk1Count, chunk1Count + chunk2Count);
  const lines3 = lines.slice(chunk1Count + chunk2Count);

  const desc1 = lines1.length > 0 ? `${guide.part1}\n\n${lines1.join("\n")}` : guide.part1;
  const desc2 = lines2.length > 0 ? `${guide.part2}\n\n${lines2.join("\n")}` : guide.part2;
  const desc3 = lines3.length > 0 ? `${guide.part3}\n\n${lines3.join("\n")}` : guide.part3;

  return [
    baseEmbed({
      title: group.title,
      description: truncate(desc1, 4000),
      color: 0x7c3aed,
      thumbnail: KOGU_AVATAR_URL,
      footer: helpFooter(locale, prefix),
    }),
    baseEmbed({
      title: undefined,
      description: truncate(desc2, 4000),
      color: 0x7c3aed,
      thumbnail: KOGU_AVATAR_URL,
      footer: helpFooter(locale, prefix),
    }),
    baseEmbed({
      title: undefined,
      description: truncate(desc3, 4000),
      color: 0x7c3aed,
      thumbnail: KOGU_AVATAR_URL,
      footer: helpFooter(locale, prefix),
    }),
  ];
}

/** Secao "Visao geral" + uma por categoria, prontas para `createPanel`. */
export function buildHelpSections(
  groups: readonly HelpGroup[],
  locale: Locale,
  prefix: string
): PanelSection[] {
  const buttons = helpButtonsRow(locale) as AnyRow;
  return [
    {
      id: OVERVIEW_SECTION_ID,
      label: msg(locale, "help.overview_label"),
      emoji: "🌌",
      render: () => ({
        embeds: [overviewEmbed(groups, locale, prefix)],
        components: [buttons],
      }),
    },
    ...groups.map(
      (group): PanelSection => ({
        id: group.category,
        label: group.title,
        description: truncate(
          group.entries
            .slice(0, 6)
            .map((e) => `${prefix}${e.name}`)
            .join(" "),
          SELECT_DESCRIPTION_MAX
        ),
        render: () => ({
          embeds: categoryEmbeds(group, locale, prefix),
          components: [buttons],
        }),
      })
    ),
  ];
}
