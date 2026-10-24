/**
 * Flags do Panteao ($ptk=, $ptw, $pth, $pty, $mm...).
 *
 * Porte de src/engine/flagsParser.ts (legado, NAO importado). Diferencas deliberadas:
 *  - `g-` agora vale ANIME (no legado o ramo `g` vinha antes e engolia `g-`); `gg-` tem prioridade.
 *  - `rl` (rank medio) nao liga tambem o `l` (rank de likes).
 *  - `arguments`/`excludedTerms` vem so dos segmentos apos o primeiro `$` (o legado empurrava o
 *    trecho das flags para `arguments`).
 *  - As flags vem apenas do sufixo do comando digitado (`ptwk=` -> `wk=`); o texto dos argumentos
 *    nao e mais lido como flag (no legado `$pt zero two` ligava `t`, `w`, `o`...).
 *  - O comando exato (`pantheon`, `mymarry`, `p`) nao tem flags.
 */

export interface ParsedFlags {
  // Genero
  gender?: "FEMALE" | "MALE" | "BOTH";
  strictGender?: boolean; // w= ou h=
  // Universos / Roleta
  universe?: "ANIME" | "GAME" | "CINEMA" | "MYTHOLOGY" | "WEAPON" | "COMPANION" | "DOMAIN";
  bothMedia?: boolean; // gg-
  // Visualizacao e detalhes
  showRollType?: boolean; // t
  showImages?: boolean; // i
  showImageTags?: boolean; // i+
  compact?: boolean; // v
  sendDm?: boolean; // s
  // Series
  groupBySeries?: boolean; // a
  showSeriesName?: boolean; // a+
  bundlesOnly?: boolean; // b
  // Rankings
  sortByClaimRank?: boolean; // r
  showClaimRank?: boolean; // r-
  sortByLikeRank?: boolean; // l
  showLikeRank?: boolean; // l-
  averageRank?: boolean; // rl
  // Eter
  showAether?: boolean; // k
  sortByAether?: boolean; // k=
  baseAetherOnly?: boolean; // k-
  // Selos de Despertar (keys)
  keysOnly?: boolean; // y
  sortByKeys?: boolean; // y=
  withAndWithoutKeys?: boolean; // y+
  withoutKeys?: boolean; // y-
  soulmatesOnly?: boolean; // y!
  sortBySoulmates?: boolean; // y!=
  // Posse
  unclaimedOnly?: boolean; // u
  showOwner?: boolean; // o
  ownedOnly?: boolean; // o=
  notOwnedByMe?: boolean; // o-
  ownedByMeOnly?: boolean; // o+
  // Outros
  alphabeticalSort?: boolean; // ==
  excludedTerms: string[]; // $--termo
  rawFlags: string;
  arguments: string[];
}

/** Interpreta a string de flags (`wk=`, `y!`, `g-v`...) e os segmentos separados por `$`. */
export function parseFlags(input: string): ParsedFlags {
  const flags: ParsedFlags = {
    excludedTerms: [],
    rawFlags: "",
    arguments: [],
  };

  if (!input) return flags;

  const parts = input.split("$").map((p) => p.trim());
  const mainPart = parts[0] ?? "";
  for (const part of parts.slice(1)) {
    if (!part) continue;
    if (part.startsWith("--")) {
      const term = part.replace(/^--/, "").trim();
      if (term) flags.excludedTerms.push(term);
    } else {
      flags.arguments.push(part);
    }
  }

  flags.rawFlags = mainPart;
  const has = (s: string) => mainPart.includes(s);

  if (has("==")) flags.alphabeticalSort = true;

  // Genero
  if (has("w=")) {
    flags.gender = "FEMALE";
    flags.strictGender = true;
  } else if (has("h=")) {
    flags.gender = "MALE";
    flags.strictGender = true;
  } else if (has("wh") || has("hw")) {
    flags.gender = "BOTH";
  } else if (has("w")) {
    flags.gender = "FEMALE";
  } else if (has("h")) {
    flags.gender = "MALE";
  }

  // Universos / roleta
  if (has("gg-")) flags.bothMedia = true;
  else if (has("g-")) flags.universe = "ANIME";
  else if (has("g")) flags.universe = "GAME";

  // Rankings
  if (has("rl")) flags.averageRank = true;
  else if (has("r-")) flags.showClaimRank = true;
  else if (has("r")) flags.sortByClaimRank = true;

  if (!flags.averageRank) {
    if (has("l-")) flags.showLikeRank = true;
    else if (has("l")) flags.sortByLikeRank = true;
  }

  // Eter
  if (has("k=")) flags.sortByAether = true;
  else if (has("k-")) flags.baseAetherOnly = true;
  else if (has("k")) flags.showAether = true;

  // Selos (keys)
  if (has("y!=")) flags.sortBySoulmates = true;
  else if (has("y!+")) flags.soulmatesOnly = true;
  else if (has("y!-")) flags.withoutKeys = true;
  else if (has("y!")) flags.soulmatesOnly = true;
  else if (has("y=")) flags.sortByKeys = true;
  else if (has("y+")) flags.withAndWithoutKeys = true;
  else if (has("y-")) flags.withoutKeys = true;
  else if (has("y")) flags.keysOnly = true;

  // Posse
  if (has("o=")) flags.ownedOnly = true;
  else if (has("o-")) flags.notOwnedByMe = true;
  else if (has("o+")) flags.ownedByMeOnly = true;
  else if (has("o")) flags.showOwner = true;
  if (has("u")) flags.unclaimedOnly = true;

  // Visual e formato
  if (has("i+")) flags.showImageTags = true;
  else if (has("i")) flags.showImages = true;
  if (has("v")) flags.compact = true;
  if (has("s")) flags.sendDm = true;
  if (has("t")) flags.showRollType = true;
  if (has("a+")) flags.showSeriesName = true;
  else if (has("a")) flags.groupBySeries = true;
  if (has("b")) flags.bundlesOnly = true;

  return flags;
}

// ---------------------------------------------------------------------------
// Atalhos do comando ($pt, $ptk=, $mmw...)
// ---------------------------------------------------------------------------

/**
 * Atalhos com sufixo de flags. Usado como `matcher` do registry: so e consultado depois de
 * nome/alias exatos (`pt`, `p`, `pantheon`, `mm`, `mymarry`) e so aceita letras de flag, para
 * nao capturar comandos desconhecidos (`ptsomething`).
 */
export const PANTHEON_SHORTCUT = /^(?:pt|mm)[whgkrlyuoivstab=!+-]*$/;

/** Parte de flags do token digitado: `ptwk=` -> `wk=`; nomes exatos (`pantheon`, `mymarry`, `p`) -> "". */
export function flagSuffix(invokedAs: string): string {
  const match = /^(?:pt|mm)(.*)$/.exec(invokedAs.trim().toLowerCase());
  return match?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Consulta do Panteao
// ---------------------------------------------------------------------------

export const PANTHEON_SORTS = [
  "default",
  "aether",
  "keys",
  "soulmates",
  "name",
  "series",
  "claimRank",
  "likeRank",
  "avgRank",
] as const;
export type PantheonSort = (typeof PANTHEON_SORTS)[number];

export const PANTHEON_GENDERS = ["FEMALE", "MALE", "NONBINARY", "ITEM"] as const;
export type PantheonGender = (typeof PANTHEON_GENDERS)[number];

export type PantheonUniverse = "ANIME" | "GAME" | "CINEMA";
export type PantheonKeysFilter = "any" | "none" | "soulmates";

export interface PantheonDisplay {
  /** `k-`: mostra o Eter base em vez do valor atual. */
  baseAether: boolean;
  /** `r-`: mostra o rank de pacto. */
  claimRank: boolean;
  /** `l-`: mostra o rank de likes. */
  likeRank: boolean;
  /** `v`: uma linha curta por entidade. */
  compact: boolean;
}

export interface PantheonQuery {
  gender?: PantheonGender;
  universe?: PantheonUniverse;
  keys?: PantheonKeysFilter;
  sort: PantheonSort;
  /** Casa com nome da entidade, serie ou franquia (qualquer um dos termos). */
  terms: string[];
  /** Exclui quem casar com algum destes termos. */
  excluded: string[];
  display: PantheonDisplay;
}

export const MAX_TERMS = 10;
export const MAX_TERM_LENGTH = 80;

const DEFAULT_DISPLAY: PantheonDisplay = {
  baseAether: false,
  claimRank: false,
  likeRank: false,
  compact: false,
};

export function emptyPantheonQuery(): PantheonQuery {
  return { sort: "default", terms: [], excluded: [], display: { ...DEFAULT_DISPLAY } };
}

function cleanTerms(terms: readonly string[]): string[] {
  return terms
    .map((t) => t.trim().slice(0, MAX_TERM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

function sortFromFlags(flags: ParsedFlags): PantheonSort {
  if (flags.sortByAether) return "aether";
  if (flags.sortBySoulmates) return "soulmates";
  if (flags.sortByKeys) return "keys";
  if (flags.alphabeticalSort) return "name";
  if (flags.averageRank) return "avgRank";
  if (flags.sortByClaimRank) return "claimRank";
  if (flags.sortByLikeRank) return "likeRank";
  if (flags.groupBySeries) return "series";
  return "default";
}

function keysFromFlags(flags: ParsedFlags): PantheonKeysFilter | undefined {
  if (flags.soulmatesOnly) return "soulmates";
  if (flags.withoutKeys) return "none";
  if (flags.keysOnly) return "any";
  return undefined; // y+ (com e sem selos) e ausencia da flag: sem filtro
}

function universeFromFlags(flags: ParsedFlags): PantheonUniverse | undefined {
  if (flags.bothMedia) return undefined;
  if (flags.universe === "ANIME" || flags.universe === "GAME" || flags.universe === "CINEMA") {
    return flags.universe;
  }
  return undefined;
}

/** Converte as flags (e termos incluidos/excluidos) em filtros e ordenacao do Panteao. */
export function toPantheonQuery(
  flags: ParsedFlags,
  extra: { terms?: readonly string[]; excluded?: readonly string[] } = {}
): PantheonQuery {
  const gender: PantheonGender | undefined =
    flags.gender === "FEMALE" ? "FEMALE" : flags.gender === "MALE" ? "MALE" : undefined;
  return {
    gender,
    universe: universeFromFlags(flags),
    keys: keysFromFlags(flags),
    sort: sortFromFlags(flags),
    terms: cleanTerms([...flags.arguments, ...(extra.terms ?? [])]),
    excluded: cleanTerms([...flags.excludedTerms, ...(extra.excluded ?? [])]),
    display: {
      baseAether: flags.baseAetherOnly === true,
      claimRank: flags.showClaimRank === true,
      likeRank: flags.showLikeRank === true,
      compact: flags.compact === true,
    },
  };
}

/** true se algum filtro restringe o conjunto de pactos (ordenacao e exibicao nao contam). */
export function hasActiveFilters(query: PantheonQuery): boolean {
  return Boolean(
    query.gender ||
    query.universe ||
    query.keys ||
    query.terms.length > 0 ||
    query.excluded.length > 0
  );
}

// ---------------------------------------------------------------------------
// Tokens do prefixo
// ---------------------------------------------------------------------------

const MENTION_RE = /^<@!?(\d{15,25})>$/;
const SNOWFLAKE_RE = /^\d{15,25}$/;

/** Id de usuario de um token (`<@id>`, `<@!id>` ou o id puro); `null` se nao for. */
export function userIdFromToken(token: string): string | null {
  const m = MENTION_RE.exec(token);
  if (m) return m[1];
  return SNOWFLAKE_RE.test(token) ? token : null;
}

export interface PantheonTokens {
  /** Primeiro usuario citado nos tokens, se houver. */
  userId: string | null;
  query: PantheonQuery;
}

/**
 * `$ptwk= @user $--naruto $bleach`: flags do sufixo de `invokedAs`; o primeiro token que e mencao
 * (ou id) escolhe o jogador; o restante, separado por `$`, vira termos (`$--x` exclui).
 */
export function parsePantheonTokens(invokedAs: string, tokens: readonly string[]): PantheonTokens {
  let userId: string | null = null;
  const rest: string[] = [];
  for (const token of tokens) {
    const id = userIdFromToken(token);
    if (id) {
      userId ??= id;
      continue;
    }
    rest.push(token);
  }

  // Sufixo + `$` + resto: o resto vira os segmentos de `parseFlags` (termos e `--exclusoes`).
  const flags = parseFlags(`${flagSuffix(invokedAs)}$${rest.join(" ")}`);
  return { userId, query: toPantheonQuery(flags) };
}

// ---------------------------------------------------------------------------
// Slash
// ---------------------------------------------------------------------------

/** Valores do option `sort` do /pantheon (nome do valor no Discord -> ordenacao). */
export const SLASH_SORTS = {
  aether: "aether",
  keys: "keys",
  soulmates: "soulmates",
  name: "name",
  series: "series",
  claim_rank: "claimRank",
  like_rank: "likeRank",
} as const satisfies Record<string, PantheonSort>;

export function queryFromSlash(input: { sort?: unknown; gender?: unknown }): PantheonQuery {
  const query = emptyPantheonQuery();
  if (typeof input.sort === "string" && Object.hasOwn(SLASH_SORTS, input.sort)) {
    query.sort = SLASH_SORTS[input.sort as keyof typeof SLASH_SORTS];
  }
  if (
    typeof input.gender === "string" &&
    (PANTHEON_GENDERS as readonly string[]).includes(input.gender)
  ) {
    query.gender = input.gender as PantheonGender;
  }
  return query;
}
