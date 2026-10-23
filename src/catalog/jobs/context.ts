import type { Logger } from "pino";
import type { KV } from "../../infra/redis/kv.js";
import type { QueueKey } from "../../infra/queue/queues.js";
import type { DbExecutor } from "../executor.js";
import { DEFAULT_FAVORITES_FLOOR } from "../quarantine.js";
import type { CatalogSource, SourceCursor, SourceId } from "../types.js";
import type { Counters } from "../upsert.js";

export type SourcesMap = Partial<Record<SourceId, CatalogSource>>;
export type SyncSourceName = SourceId | "MANUAL";

export interface JobContext {
  db: DbExecutor;
  kv: KV;
  sources: SourcesMap;
  log: Logger;
  now: () => Date;
  /** Catalogo aceita conteudo adulto (padrao false). */
  allowAdult: boolean;
  favoritesFloor: Readonly<Record<string, number>>;
  /** Injetaveis para images.verify nos testes. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
  /** Pede um rerank adiado (o worker enfileira com debounce; syncOnce ignora). */
  requestRerank?: () => Promise<void>;
}

export function createJobContext(
  base: Pick<JobContext, "db" | "kv" | "log"> & Partial<JobContext>
): JobContext {
  return {
    sources: {},
    now: () => new Date(),
    allowAdult: process.env.CATALOG_ALLOW_ADULT === "true",
    favoritesFloor: DEFAULT_FAVORITES_FLOOR,
    ...base,
  };
}

export interface JobInput {
  /** Maximo de itens (series) desta execucao; cada job tem seu padrao. */
  limit?: number;
}

export interface JobHandle {
  runId: number;
  /** Cursor salvo da execucao anterior (catalog_sources). */
  cursor: SourceCursor;
  /** Persiste o cursor no meio da execucao (retomada apos queda). */
  saveCursor: (cursor: SourceCursor) => Promise<void>;
}

export interface JobResult {
  counters: Counters;
  cursor?: SourceCursor;
  meta?: Record<string, unknown>;
  /** Falha que interrompeu o job (o que foi processado antes e mantido). */
  fatal?: string;
}

export interface JobDef {
  /** Ex.: "anilist.trending". */
  name: string;
  queue: QueueKey;
  /** Valor gravado em sync_runs.source (jobs internos usam MANUAL). */
  source: SyncSourceName;
  /** Fonte exigida: sem ela o worker nao agenda o job. */
  sourceId?: SourceId;
  schedule: { every?: number; pattern?: string };
  run(ctx: JobContext, input: JobInput, handle: JobHandle): Promise<JobResult>;
}
