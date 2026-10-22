export type SourceId = "ANILIST" | "JIKAN" | "IGDB" | "TMDB";
export type MediaType = "ANIME" | "MANGA" | "LIGHT_NOVEL" | "GAME" | "MOVIE" | "TV";
export type RawGender = "FEMALE" | "MALE" | "NONBINARY" | "UNKNOWN";
export type SeriesStatus = "RELEASING" | "FINISHED" | "UPCOMING";

/** Serie/obra como veio da fonte, ja com campos minimos normalizados. */
export interface RawSeries {
  source: SourceId;
  externalId: string;
  title: string;
  titleNative?: string;
  titleEnglish?: string;
  mediaType: MediaType;
  status: SeriesStatus;
  startDate?: Date;
  endDate?: Date;
  /** Metrica nativa de popularidade da fonte (favoritos, follows, hypes...). */
  popularity: number;
  coverUrl?: string;
  isAdult: boolean;
  /** IDs equivalentes em outras fontes, p.ex. idMal no AniList. */
  crossIds?: Partial<Record<SourceId, string>>;
  /** True para animacao (relevante no TMDB). */
  isAnimation?: boolean;
  url?: string;
}

export interface RawCharacter {
  source: SourceId;
  externalId: string;
  name: string;
  nameNative?: string;
  aliases?: string[];
  gender: RawGender;
  description?: string;
  imageUrl?: string;
  /** Favoritos/curtidas na fonte. */
  favourites: number;
  seriesExternalId: string;
  role?: "MAIN" | "SUPPORTING";
  isAdult?: boolean;
  /** True se a fonte indica pessoa real (fotos de atores). */
  isRealPerson?: boolean;
  url?: string;
}

export interface SourceCursor {
  [key: string]: string | number | boolean | null;
}

export interface DiscoverOptions {
  /** Maximo de series a retornar nesta chamada. */
  limit?: number;
  cursor?: SourceCursor;
  signal?: AbortSignal;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Contrato de cada fonte do catalogo. `fetchImpl` e injetavel para testes. */
export interface CatalogSource {
  readonly id: SourceId;
  /** Ritmo maximo configurado (req/min) usado pelo rate limiter. */
  readonly ratePerMin: number;
  /** Descobre series novas/populares, paginando por cursor. */
  discover(opts?: DiscoverOptions): AsyncIterable<RawSeries>;
  /** Personagens de uma serie, ordenados por favoritos. */
  fetchCharacters(seriesExternalId: string, opts?: { limit?: number }): Promise<RawCharacter[]>;
  /** Revalida entradas por ID externo (favoritos, imagem). */
  refresh(externalIds: string[]): Promise<RawCharacter[]>;
}
