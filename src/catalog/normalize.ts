import { nameTokens, normalizeName, slugify, stripHtml } from "../lib/text/normalize.js";
import type { NewEntity, NewSeries } from "../infra/db/schema/index.js";
import type { MediaType, RawCharacter, RawGender, RawSeries, SourceId } from "./types.js";

/* ------------------------------------------------------------------ */
/* Mapa MediaType (contrato das fontes) -> enums do schema            */
/* ------------------------------------------------------------------ */

export type DbMediaType = NonNullable<NewSeries["mediaType"]>;
export type Universe = NewSeries["universe"];
export type DbGender = NonNullable<NewEntity["gender"]>;

/**
 * MediaType do contrato -> `media_type` do schema.
 *
 * - ANIME -> ANIME_TV: `RawSeries` nao informa o formato (filme/OVA/ONA); ANIME_MOVIE, ANIME_OVA e
 *   ANIME_ONA ficam reservados para quando o contrato ganhar esse campo.
 * - LIGHT_NOVEL -> MANGA: o enum nao tem light novel; e midia impressa do universo ANIME.
 * - TV -> TV_SHOW. Nenhuma fonte produz OTHER (so migracoes e cadastros manuais).
 */
export const MEDIA_TYPE_MAP: Readonly<Record<MediaType, DbMediaType>> = {
  ANIME: "ANIME_TV",
  MANGA: "MANGA",
  LIGHT_NOVEL: "MANGA",
  GAME: "GAME",
  MOVIE: "MOVIE",
  TV: "TV_SHOW",
};

/**
 * Universo derivado do MediaType da fonte (nao do valor ja mapeado, que perderia LIGHT_NOVEL).
 * Animacao do TMDB continua em CINEMA: universo e "de onde vem", nao o estilo de arte.
 */
export const UNIVERSE_BY_MEDIA_TYPE: Readonly<Record<MediaType, Universe>> = {
  ANIME: "ANIME",
  MANGA: "ANIME",
  LIGHT_NOVEL: "ANIME",
  GAME: "GAME",
  MOVIE: "CINEMA",
  TV: "CINEMA",
};

export function mapMediaType(mediaType: MediaType): DbMediaType {
  return MEDIA_TYPE_MAP[mediaType];
}

export function universeOf(mediaType: MediaType): Universe {
  return UNIVERSE_BY_MEDIA_TYPE[mediaType];
}

/* ------------------------------------------------------------------ */
/* Prioridade das fontes                                              */
/* ------------------------------------------------------------------ */

/** Quem manda nos campos descritivos quando varias fontes conhecem a mesma entidade. */
export const SOURCE_PRIORITY: readonly string[] = ["ANILIST", "IGDB", "TMDB", "JIKAN", "MANUAL", "LEGACY"];

/** Menor = mais prioritario. Fonte desconhecida vai para o fim. */
export function sourcePriority(source: string): number {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i === -1 ? SOURCE_PRIORITY.length : i;
}

/** Fonte primaria de uma entidade: a de maior prioridade entre os seus external ids. */
export function primarySourceOf(sources: readonly string[]): string {
  let best = "LEGACY";
  let bestRank = Number.POSITIVE_INFINITY;
  for (const s of sources) {
    const r = sourcePriority(s);
    if (r < bestRank) {
      best = s;
      bestRank = r;
    }
  }
  return best;
}

/** Fontes reais do catalogo (contam para o bonus de multiplas fontes). */
export const REAL_SOURCES: readonly SourceId[] = ["ANILIST", "JIKAN", "IGDB", "TMDB"];

/* ------------------------------------------------------------------ */
/* Series e franquias                                                 */
/* ------------------------------------------------------------------ */

export interface SeriesFields {
  title: string;
  titleNative: string | null;
  mediaType: DbMediaType;
  universe: Universe;
  isAdult: boolean;
  releasedAt: Date | null;
  coverUrl: string | null;
}

function clean(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Data (UTC) sem hora para a coluna `date`. */
export function toDateOnly(d: Date | undefined): Date | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toSeriesFields(raw: RawSeries): SeriesFields {
  const native = clean(raw.titleNative);
  return {
    title: clean(raw.title) || clean(raw.titleEnglish),
    titleNative: native === "" ? null : native,
    mediaType: mapMediaType(raw.mediaType),
    universe: universeOf(raw.mediaType),
    isAdult: raw.isAdult === true,
    releasedAt: toDateOnly(raw.startDate),
    coverUrl: normalizeImageUrl(raw.coverUrl),
  };
}

/** Sufixos de temporada/parte removidos para agrupar obras na mesma franquia. */
const SEASON_SUFFIXES: readonly RegExp[] = [
  /\s*[:\-–—]\s*(the\s+)?(final|last)\s+season\b.*$/i,
  /\s+(the\s+)?(final|last)\s+season\b.*$/i,
  /\s+\d+(st|nd|rd|th)\s+season\b.*$/i,
  /\s+season\s+\d+\b.*$/i,
  /\s+part\s+\d+\b.*$/i,
  /\s+(?:cour|s)\s?\d+$/i,
  /\s+\(\d{4}\)$/,
  /\s+(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i,
];

/**
 * Nome de franquia heuristico, ja que nenhuma fonte entrega a franquia:
 * remove sufixos de temporada/parte ("Attack on Titan Season 2" -> "Attack on Titan") e, para jogos,
 * o subtitulo apos ":" ("The Legend of Zelda: Breath of the Wild" -> "The Legend of Zelda").
 * Nunca devolve menos de 2 caracteres: nesse caso mantem o titulo.
 */
export function deriveFranchiseName(title: string, mediaType: MediaType): string {
  const original = clean(title);
  let name = original;
  for (const re of SEASON_SUFFIXES) {
    const next = name.replace(re, "").trim();
    if (next.length >= 2) name = next;
  }
  if (mediaType === "GAME") {
    const colon = name.indexOf(":");
    if (colon >= 4) name = name.slice(0, colon).trim();
  }
  return name.length >= 2 ? name : original;
}

/* ------------------------------------------------------------------ */
/* Slugs                                                              */
/* ------------------------------------------------------------------ */

const SLUG_MAX = 80;

/**
 * Candidatos de slug, do mais legivel ao garantidamente unico:
 * `base`, `base-<fonte>`, `base-<fonte>-<id externo>`. O slug escolhido na criacao nunca muda,
 * entao e estavel entre sincronizacoes.
 */
export function slugCandidates(text: string, source: string, externalId: string): string[] {
  const src = source.toLowerCase();
  const ext = slugify(externalId, 40) || "x";
  const base = slugify(text, SLUG_MAX) || `${src}-${ext}`;
  return [base, `${base}-${src}`, `${base}-${src}-${ext}`];
}

/* ------------------------------------------------------------------ */
/* Imagens                                                            */
/* ------------------------------------------------------------------ */

/** Placeholders de "sem imagem" das fontes: tratados como ausencia de imagem. */
const PLACEHOLDER_IMAGES: readonly RegExp[] = [
  /\/character\/(?:large|medium|small)\/default\.(?:jpg|png)$/i,
  /\/images\/questionmark_\d+\.(?:gif|png|jpg)$/i,
  /\/na\.(?:gif|png|jpg)$/i,
];

export const IMAGE_URL_MAX = 2048;

/** URL https valida e nao-placeholder, ou null. */
export function normalizeImageUrl(url: string | undefined | null): string | null {
  const raw = clean(url);
  if (raw === "" || raw.length > IMAGE_URL_MAX) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (PLACEHOLDER_IMAGES.some((re) => re.test(u.pathname))) return null;
  return u.href;
}

/* ------------------------------------------------------------------ */
/* Entidades                                                          */
/* ------------------------------------------------------------------ */

export interface EntityFields {
  name: string;
  nameNative: string | null;
  /** Tokens ordenados: chave de dedupe entre fontes. */
  nameNormalized: string;
  universe: Universe;
  gender: DbGender;
  description: string | null;
  isAdult: boolean;
  sourceFavorites: number;
  imageUrl: string | null;
}

const INT32_MAX = 2_147_483_647;
const DESCRIPTION_MAX = 1000;

/** Chave de dedupe: tokens do nome normalizado, ordenados ("Satoru Gojo" == "Gojo Satoru"). */
export function nameKey(name: string): string {
  return nameTokens(name).join(" ");
}

function clampFavourites(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(INT32_MAX, Math.round(n));
}

function cleanDescription(s: string | undefined): string | null {
  if (!s) return null;
  const text = stripHtml(s);
  if (text === "") return null;
  if (text.length <= DESCRIPTION_MAX) return text;
  return `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

/** Genero vindo da fonte. UNKNOWN permanece UNKNOWN: o catalogo nunca sorteia genero. */
export function mapGender(gender: RawGender | undefined): DbGender {
  switch (gender) {
    case "FEMALE":
    case "MALE":
    case "NONBINARY":
      return gender;
    default:
      return "UNKNOWN";
  }
}

export function toEntityFields(
  raw: RawCharacter,
  ctx: { universe: Universe; seriesIsAdult: boolean }
): EntityFields {
  const name = clean(raw.name);
  const native = clean(raw.nameNative);
  const key = nameKey(name);
  return {
    name,
    nameNative: native === "" ? null : native,
    nameNormalized: key === "" ? normalizeName(name) : key,
    universe: ctx.universe,
    gender: mapGender(raw.gender),
    description: cleanDescription(raw.description),
    isAdult: raw.isAdult === true || ctx.seriesIsAdult,
    sourceFavorites: clampFavourites(raw.favourites),
    imageUrl: normalizeImageUrl(raw.imageUrl),
  };
}
