import type {
  CatalogSource,
  DiscoverOptions,
  RawCharacter,
  RawSeries,
  SourceId,
} from "../../../src/catalog/types.js";

export interface FakeData {
  series: RawSeries[];
  chars: Record<string, RawCharacter[]>;
}

/** Fonte falsa deterministica que implementa o contrato CatalogSource. */
export class FakeSource implements CatalogSource {
  readonly ratePerMin = 100_000;
  /** Se definido, discover lanca este erro. */
  failWith?: Error;
  /** Atraso (ms) por serie, para testar concorrencia de locks. */
  delayMs = 0;
  calls = 0;

  constructor(
    readonly id: SourceId,
    public data: FakeData
  ) {}

  async *discover(opts: DiscoverOptions = {}): AsyncIterable<RawSeries> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    let n = 0;
    for (const s of this.data.series) {
      if (opts.limit !== undefined && n >= opts.limit) return;
      n++;
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      yield s;
    }
  }

  async fetchCharacters(id: string, o: { limit?: number } = {}): Promise<RawCharacter[]> {
    return (this.data.chars[id] ?? []).slice(0, o.limit);
  }

  async refresh(): Promise<RawCharacter[]> {
    return [];
  }
}

export function mkSeries(source: SourceId, i: number, over: Partial<RawSeries> = {}): RawSeries {
  return {
    source,
    externalId: String(i),
    title: `Series ${i}`,
    mediaType: source === "IGDB" ? "GAME" : "ANIME",
    status: "FINISHED",
    popularity: 1000,
    isAdult: false,
    startDate: new Date("2015-04-01T00:00:00Z"),
    ...over,
  };
}

const FIRST = ["Akira", "Bruno", "Chiara", "Dmitri", "Elena", "Farid", "Greta", "Hiroshi"];
const LAST = ["Tanaka", "Silva", "Rossi", "Volkov", "Petrova", "Hassan", "Larsen", "Okabe"];

export function mkChar(
  source: SourceId,
  seriesId: string,
  i: number,
  over: Partial<RawCharacter> = {}
): RawCharacter {
  return {
    source,
    externalId: `${seriesId}-${i}`,
    name: `${FIRST[i % FIRST.length]} ${LAST[Number(seriesId) % LAST.length]}`,
    gender: i % 2 === 0 ? "FEMALE" : "MALE",
    favourites: 1000 + i * 100,
    seriesExternalId: seriesId,
    imageUrl: `https://s4.anilist.co/img/${seriesId}-${i}.png`,
    ...over,
  };
}

