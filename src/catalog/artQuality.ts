import { looksLikeObjectName, pickEmblem, type EmblemKey } from "../canvas/emblems/pick.js";

/**
 * Qualidade da arte de uma carta, por heuristica de URL. Modulo puro (sem rede, sem I/O).
 *
 * Problema: fontes como IGDB (capa do jogo) e TMDB (poster) devolvem a OBRA, nao o personagem/objeto.
 * Itens (armas etc.) nunca sao confiaveis com arte de personagem/capa; so com override curado.
 */

export type ArtKind = "CHARACTER" | "POSTER" | "COVER" | "PLACEHOLDER" | "MISSING" | "UNKNOWN";

export interface ArtClassification {
  kind: ArtKind;
  /** true = a imagem pode ser desenhada na carta como esta. */
  trusted: boolean;
  reason: string;
}

export interface ArtSubject {
  /** Tipo da entidade (`entity_type`); ausente = inferir pelo nome. */
  type?: string | null;
  universe?: string | null;
  imageUrl?: string | null;
  name?: string | null;
}

export const ITEM_ENTITY_TYPES: readonly string[] = ["WEAPON", "COMPANION", "DOMAIN"];

/** Placeholders conhecidos de "sem imagem" / avatar padrao (caminho da URL). */
const PLACEHOLDER_PATHS: readonly RegExp[] = [
  /\/character\/(?:large|medium|small)\/default\.(?:jpg|png)$/i, // AniList
  /\/(?:staff|user)\/(?:large|medium|small)\/default\.(?:jpg|png)$/i,
  /\/images\/questionmark_\d+\.(?:gif|png|jpg)$/i, // MAL/Jikan
  /\/na\.(?:gif|png|jpg)$/i,
  /\/embed\/avatars\/\d+\.png$/i, // avatar padrao (roxo) do Discord
  /(?:^|[/_-])(?:placeholder|default[-_]?avatar|no[-_]?image|noimage|blank[-_]?avatar)(?:[._/-]|$)/i,
];

/** Pasta das fotos proprias do catalogo (GitHub Pages) e o caminho relativo usado em docs/catalog.json. */
const OWN_HOST = "yo-apollon.github.io";
const OWN_PATH = /^\/kogu\/assets\/cards\//i;
const OWN_RELATIVE = /^\.?\/?assets\/cards\//i;

/** Tamanhos TMDB de perfil de pessoa (foto de pessoa); os demais sao poster/backdrop. */
const TMDB_PROFILE_SIZES = new Set(["w45", "w185", "h632"]);
const TMDB_POSTER_SIZES = new Set(["w92", "w154", "w342", "w500", "w780", "original"]);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** O sujeito e um item/objeto (arma, companheiro, dominio ou nome de objeto quando o tipo e desconhecido)? */
export function isItemSubject(s: Pick<ArtSubject, "type" | "name">): boolean {
  if (s.type) return ITEM_ENTITY_TYPES.includes(s.type.toUpperCase());
  return looksLikeObjectName(s.name ?? "");
}

/** Classifica so a URL (sem considerar o tipo da entidade). */
function classifyUrl(imageUrl: string | null | undefined): { kind: ArtKind; reason: string } {
  const raw = (imageUrl ?? "").trim();
  if (raw === "") return { kind: "MISSING", reason: "sem imagem" };

  if (OWN_RELATIVE.test(raw)) return { kind: "CHARACTER", reason: "foto propria do catalogo (caminho relativo)" };

  const u = parseUrl(raw);
  if (!u) return { kind: "UNKNOWN", reason: "URL nao analisavel" };
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (PLACEHOLDER_PATHS.some((re) => re.test(path))) {
    return { kind: "PLACEHOLDER", reason: "imagem padrao/placeholder conhecida" };
  }

  if (host === OWN_HOST && OWN_PATH.test(path)) {
    return { kind: "CHARACTER", reason: "foto propria do catalogo" };
  }

  if (host === "images.igdb.com") {
    if (/\/t_(?:cover_[a-z0-9_]+|thumb|micro|logo_med)\//i.test(path)) {
      return { kind: "COVER", reason: "IGDB t_cover: capa do jogo, nao o personagem" };
    }
    return { kind: "POSTER", reason: "IGDB: imagem promocional do jogo (captura/arte), nao o personagem" };
  }

  if (host === "image.tmdb.org") {
    const m = /\/t\/p\/([a-z]+\d*)\//i.exec(path);
    const size = m?.[1]?.toLowerCase();
    if (size && TMDB_PROFILE_SIZES.has(size)) return { kind: "CHARACTER", reason: `TMDB ${size}: foto de perfil de pessoa` };
    if (size && TMDB_POSTER_SIZES.has(size)) return { kind: "POSTER", reason: `TMDB ${size}: poster/backdrop do filme` };
    return { kind: "POSTER", reason: "TMDB: imagem de obra (tamanho desconhecido)" };
  }

  if (host === "s4.anilist.co") {
    if (/\/character\/(?:large|medium|small)\//i.test(path)) return { kind: "CHARACTER", reason: "AniList character: arte do personagem" };
    if (/\/(?:media|cover)\//i.test(path) || /\/anime\/cover\//i.test(path)) {
      return { kind: "COVER", reason: "AniList: capa da obra" };
    }
    return { kind: "UNKNOWN", reason: "AniList: caminho desconhecido" };
  }

  if (host === "cdn.myanimelist.net" && /\/images\/characters\//i.test(path)) {
    return { kind: "CHARACTER", reason: "MyAnimeList characters: arte do personagem" };
  }

  return { kind: "UNKNOWN", reason: `host sem heuristica (${host})` };
}

/**
 * Classifica a arte. `trusted` so e true quando a imagem pode ser usada como esta:
 * personagem com arte de personagem (ou host desconhecido, que nao e sabidamente ruim).
 * Itens (WEAPON/COMPANION/DOMAIN ou nome de objeto) NUNCA sao confiaveis sem override `kind: 'ITEM'`.
 */
export function classifyArt(subject: ArtSubject): ArtClassification {
  const { kind, reason } = classifyUrl(subject.imageUrl);
  const item = isItemSubject(subject);

  if (kind === "MISSING" || kind === "PLACEHOLDER") return { kind, trusted: false, reason };
  if (item) {
    return { kind, trusted: false, reason: `item: arte de ${kind} nao serve; exige override ITEM (${reason})` };
  }
  if (kind === "POSTER" || kind === "COVER") return { kind, trusted: false, reason };
  return { kind, trusted: true, reason };
}

/* ------------------------------------------------------------------ */
/* Overrides e resolucao da arte                                       */
/* ------------------------------------------------------------------ */

export type OverrideKind = "CHARACTER" | "ITEM";

/** Entrada de data/art/overrides.json. */
export interface ArtOverride {
  slug: string;
  url: string;
  kind: OverrideKind;
  source: string;
  credit?: string;
}

export interface CardArtEntity extends ArtSubject {
  slug?: string | null;
  description?: string | null;
  /** Imagem escolhida pelo dono do pacto (`custom_image_url`): ja validada/moderada, sempre usada. */
  trustImage?: boolean;
}

export type CardArt = { mode: "IMAGE"; url: string } | { mode: "EMBLEM"; emblem: EmblemKey };

/** Indice por slug (o ultimo override do mesmo slug vence). */
export function indexOverrides(overrides: readonly ArtOverride[]): Map<string, ArtOverride> {
  const map = new Map<string, ArtOverride>();
  for (const o of overrides) map.set(o.slug, o);
  return map;
}

/**
 * Decide a arte final: IMAGE so se confiavel (ou override/imagem do dono); caso contrario EMBLEMA original
 * (classe de item pelo nome, ou busto generico para personagem sem arte).
 */
export function resolveCardArt(
  entity: CardArtEntity,
  overrides: readonly ArtOverride[] | ReadonlyMap<string, ArtOverride> = []
): CardArt {
  const url = (entity.imageUrl ?? "").trim();
  if (entity.trustImage && url !== "") return { mode: "IMAGE", url };

  if (entity.slug) {
    const o = overrides instanceof Map ? overrides.get(entity.slug) : indexOverrides(overrides as readonly ArtOverride[]).get(entity.slug);
    if (o) return { mode: "IMAGE", url: o.url };
  }

  const c = classifyArt(entity);
  if (c.trusted) return { mode: "IMAGE", url };
  const emblem: EmblemKey = isItemSubject(entity) ? pickEmblem(entity.name ?? "", entity.description) : "character";
  return { mode: "EMBLEM", emblem };
}
