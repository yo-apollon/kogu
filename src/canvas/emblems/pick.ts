/**
 * Escolha do emblema por palavras-chave (pt-BR e en-US). Modulo puro: sem canvas, sem I/O.
 * Os emblemas sao classes GENERICAS de arma/item; nunca reproduzem um objeto especifico de uma obra.
 */

export const ITEM_EMBLEMS = [
  "sword",
  "axe",
  "hammer",
  "staff",
  "shield",
  "bow",
  "gun",
  "scythe",
  "spear",
  "dagger",
  "energy_blade",
  "armor",
  "ring",
  "book",
  "orb",
  "potion",
  "crown",
  "gem",
] as const;

export type ItemEmblemKey = (typeof ITEM_EMBLEMS)[number];
/** `character` = busto generico + iniciais, para personagem sem arte confiavel. */
export type EmblemKey = ItemEmblemKey | "character";
export const EMBLEM_KEYS: readonly EmblemKey[] = [...ITEM_EMBLEMS, "character"];

/** Normaliza: minusculas, sem acento. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Ordem importa: o primeiro padrao que casar vence (ex.: "sabre de luz" antes de "sabre"). */
const RULES: ReadonlyArray<readonly [ItemEmblemKey, RegExp]> = [
  ["energy_blade", /\b(?:sabres? de luz|lightsabers?|light sabers?|energy (?:blade|sword)s?|laminas? de energia|espadas? de energia|plasma (?:blade|sword)s?|beam (?:sword|saber)s?|energia)\b/],
  ["scythe", /\b(?:foices?|scythes?|sickles?|gadanhas?)\b/],
  ["axe", /\b(?:machados?|axes?|tomahawks?|battleaxes?)\b/],
  ["hammer", /\b(?:martelos?|hammers?|mjolnir|marretas?|mauls?|maces?|macas?)\b/],
  ["staff", /\b(?:cajados?|staffs?|staves|wands?|varinhas?|bastoes|bastao|cetros?|sceptres?|scepters?|rods?)\b/],
  ["shield", /\b(?:escudos?|shields?|aegis)\b/],
  ["bow", /\b(?:arcos?|bows?|crossbows?|bestas?|arco e flecha)\b/],
  ["gun", /\b(?:pistolas?|armas? de fogo|guns?|pistols?|revolvers?|rifles?|fuzis?|fuzil|canhoes|canhao|cannons?|shotguns?|espingardas?|bfg)\b/],
  ["spear", /\b(?:lancas?|spears?|lances?|tridentes?|tridents?|halberds?|alabardas?|glaives?)\b/],
  ["dagger", /\b(?:adagas?|daggers?|kunais?|punhais|punhal|knives|knife|facas?|shurikens?)\b/],
  ["sword", /\b(?:espadas?|laminas?|katanas?|swords?|blades?|sabres?|sabers?|rapiers?|claymores?|cutlass(?:es)?|machetes?|scimitars?|greatswords?|excalibur)\b/],
  ["armor", /\b(?:armaduras?|armou?rs?|capacetes?|helmets?|couracas?|cuirass(?:es)?|gauntlets?|manoplas?|breastplates?)\b/],
  ["ring", /\b(?:aneis|anel|rings?|aliancas?)\b/],
  ["book", /\b(?:livros?|books?|tomos?|grimorios?|grimoires?|cadernos?|notebooks?|codex|necronomicon|scrolls?|pergaminhos?|diarios?)\b/],
  ["orb", /\b(?:orbes?|orbs?|esferas?|spheres?|crystal balls?)\b/],
  ["potion", /\b(?:pocoes|pocao|potions?|elixires?|elixirs?|frascos?|vials?|flasks?)\b/],
  ["crown", /\b(?:coroas?|crowns?|tiaras?|diademas?)\b/],
  ["gem", /\b(?:joias?|jewels?|gems?|cristais|cristal|crystals?|pedras?|stones?|diamantes?|diamonds?)\b/],
];

function matchKeyword(text: string): ItemEmblemKey | null {
  const folded = fold(text);
  for (const [key, re] of RULES) if (re.test(folded)) return key;
  return null;
}

/** Emblema por palavra-chave do nome (e, depois, da descricao). Padrao: joia generica. */
export function pickEmblem(name: string, description?: string | null): ItemEmblemKey {
  return matchKeyword(name) ?? (description ? matchKeyword(description) : null) ?? "gem";
}

/** O NOME indica um objeto? (usado so quando o tipo da entidade e desconhecido). */
export function looksLikeObjectName(name: string): boolean {
  return matchKeyword(name) !== null;
}
