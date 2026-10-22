export interface ParsedFlags {
  // Gênero
  gender?: "FEMALE" | "MALE" | "BOTH";
  strictGender?: boolean; // w= ou h=
  // Universos / Roleta
  universe?: "ANIME" | "GAME" | "CINEMA" | "MYTHOLOGY" | "WEAPON" | "COMPANION" | "DOMAIN";
  bothMedia?: boolean; // gg-
  // Visualização e Detalhes
  showRollType?: boolean; // t
  showImages?: boolean; // i
  showImageTags?: boolean; // i+
  compact?: boolean; // v
  sendDm?: boolean; // s
  // Séries
  groupBySeries?: boolean; // a
  showSeriesName?: boolean; // a+
  bundlesOnly?: boolean; // b
  // Rankings
  sortByClaimRank?: boolean; // r
  showClaimRank?: boolean; // r-
  sortByLikeRank?: boolean; // l
  showLikeRank?: boolean; // l-
  averageRank?: boolean; // rl
  // Éter (Kakera)
  showAether?: boolean; // k
  sortByAether?: boolean; // k=
  baseAetherOnly?: boolean; // k-
  // Selos de Despertar (Keys)
  keysOnly?: boolean; // y
  sortByKeys?: boolean; // y=
  withAndWithoutKeys?: boolean; // y+
  withoutKeys?: boolean; // y-
  soulmatesOnly?: boolean; // y!
  sortBySoulmates?: boolean; // y!=
  // Posse (Claims)
  unclaimedOnly?: boolean; // u
  showOwner?: boolean; // o
  ownedOnly?: boolean; // o=
  notOwnedByMe?: boolean; // o-
  ownedByMeOnly?: boolean; // o+
  // Outros
  alphabeticalSort?: boolean; // ==
  excludedTerms: string[]; // --termo
  rawFlags: string;
  arguments: string[];
}

export function parseFlags(input: string): ParsedFlags {
  const flags: ParsedFlags = {
    excludedTerms: [],
    rawFlags: "",
    arguments: [],
  };

  if (!input) return flags;

  // Separa argumentos com $
  const parts = input.split("$").map((p) => p.trim());
  const mainPart = parts[0] || "";

  // Procura por termos de exclusão (--)
  for (const part of parts) {
    if (part.startsWith("--")) {
      flags.excludedTerms.push(part.replace(/^--/, "").trim());
    } else {
      flags.arguments.push(part);
    }
  }

  // Identifica as flags coladas no comando (ex: w, h, k=, r, u, y, etc.)
  flags.rawFlags = mainPart;

  if (mainPart.includes("==")) flags.alphabeticalSort = true;
  if (mainPart.includes("w=")) {
    flags.gender = "FEMALE";
    flags.strictGender = true;
  } else if (mainPart.includes("h=")) {
    flags.gender = "MALE";
    flags.strictGender = true;
  } else if (mainPart.includes("wh") || mainPart.includes("hw")) {
    flags.gender = "BOTH";
  } else if (mainPart.includes("w")) {
    flags.gender = "FEMALE";
  } else if (mainPart.includes("h")) {
    flags.gender = "MALE";
  }

  // Universos / Roleta
  if (mainPart.includes("g=")) {
    flags.universe = "GAME";
  } else if (mainPart.includes("g-=")) {
    flags.universe = "ANIME";
  } else if (mainPart.includes("gg-")) {
    flags.bothMedia = true;
  } else if (mainPart.includes("g")) {
    flags.universe = "GAME";
  } else if (mainPart.includes("g-")) {
    flags.universe = "ANIME";
  }

  // Rankings e Ordenação
  if (mainPart.includes("rl")) flags.averageRank = true;
  else if (mainPart.includes("r-")) flags.showClaimRank = true;
  else if (mainPart.includes("r")) flags.sortByClaimRank = true;

  if (mainPart.includes("l-")) flags.showLikeRank = true;
  else if (mainPart.includes("l")) flags.sortByLikeRank = true;

  // Éter
  if (mainPart.includes("k=")) flags.sortByAether = true;
  else if (mainPart.includes("k-")) flags.baseAetherOnly = true;
  else if (mainPart.includes("k")) flags.showAether = true;

  // Selos (Keys)
  if (mainPart.includes("y!=")) flags.sortBySoulmates = true;
  else if (mainPart.includes("y!+")) flags.soulmatesOnly = true;
  else if (mainPart.includes("y!-")) flags.withoutKeys = true;
  else if (mainPart.includes("y!")) flags.soulmatesOnly = true;
  else if (mainPart.includes("y=")) flags.sortByKeys = true;
  else if (mainPart.includes("y+")) flags.withAndWithoutKeys = true;
  else if (mainPart.includes("y-")) flags.withoutKeys = true;
  else if (mainPart.includes("y")) flags.keysOnly = true;

  // Posse
  if (mainPart.includes("o=")) flags.ownedOnly = true;
  else if (mainPart.includes("o-")) flags.notOwnedByMe = true;
  else if (mainPart.includes("o+")) flags.ownedByMeOnly = true;
  else if (mainPart.includes("o")) flags.showOwner = true;
  if (mainPart.includes("u")) flags.unclaimedOnly = true;

  // Visual e Formato
  if (mainPart.includes("i+")) flags.showImageTags = true;
  else if (mainPart.includes("i")) flags.showImages = true;
  if (mainPart.includes("v")) flags.compact = true;
  if (mainPart.includes("s")) flags.sendDm = true;
  if (mainPart.includes("t")) flags.showRollType = true;
  if (mainPart.includes("a+")) flags.showSeriesName = true;
  else if (mainPart.includes("a")) flags.groupBySeries = true;
  if (mainPart.includes("b")) flags.bundlesOnly = true;

  return flags;
}
