import { sleep as defaultSleep } from "../time.js";

/** Erro HTTP com status e dica de espera (Retry-After) do servidor. */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, message?: string, opts: { retryAfterMs?: number; cause?: unknown } = {}) {
    super(message ?? `HTTP ${status}`, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "HttpStatusError";
    this.status = status;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
  }
}

/** 408, 429 e 5xx sao retentaveis; os demais 4xx nao. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Interpreta o header Retry-After (segundos ou data HTTP) e devolve ms.
 * Retorna undefined se ausente ou invalido.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined;
  const raw = value.trim();
  if (raw === "") return undefined;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/** Extrai a espera pedida pelo servidor de um erro (retryAfterMs, headers ou response.headers). */
export function getRetryAfterMs(err: unknown, now: number = Date.now()): number | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as Record<string, any>;
  if (typeof e.retryAfterMs === "number" && Number.isFinite(e.retryAfterMs) && e.retryAfterMs >= 0) {
    return e.retryAfterMs;
  }
  const headers = e.headers ?? e.response?.headers;
  if (headers === null || typeof headers !== "object") return undefined;
  const raw = typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"];
  return typeof raw === "string" ? parseRetryAfter(raw, now) : undefined;
}

/**
 * Politica padrao: com `status` numerico decide por ele; TIMEOUT e falhas de rede
 * (SafeFetchError HTTP_ERROR sem status) retentam; demais SafeFetchError (bloqueios,
 * tamanho, tipo) nao; qualquer outro erro e tratado como falha transitoria.
 */
export function defaultShouldRetry(err: unknown): boolean {
  if (err === null || typeof err !== "object") return true;
  const e = err as Record<string, any>;
  if (typeof e.status === "number") return isRetryableStatus(e.status);
  if (e.name === "SafeFetchError") return e.code === "TIMEOUT" || e.code === "HTTP_ERROR";
  return true;
}

export interface RetryOptions {
  /** Numero de retentativas apos a primeira tentativa. */
  retries: number;
  baseMs: number;
  maxMs: number;
  jitter: boolean;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Chamado antes de cada espera (para log). `attempt` e a proxima tentativa (1-based). */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 5, baseMs: 1000, maxMs: 60_000, jitter: true };

/** Calcula a espera: backoff exponencial (com jitter) ou o Retry-After, o que for maior. */
export function computeDelayMs(
  attempt: number,
  err: unknown,
  opts: Pick<RetryOptions, "baseMs" | "maxMs" | "jitter"> & { random?: () => number; now?: number },
): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
  const backoff = opts.jitter ? exp * (0.5 + (opts.random ?? Math.random)() * 0.5) : exp;
  const hinted = getRetryAfterMs(err, opts.now);
  // O pedido do servidor e respeitado mesmo acima de maxMs.
  return Math.round(hinted === undefined ? backoff : Math.max(backoff, hinted));
}

/** Executa `fn` com retentativas. `fn` recebe o indice da tentativa (0-based). */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  const sleep = opts.sleep ?? defaultSleep;
  const clock = opts.now ?? Date.now;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !shouldRetry(err, attempt)) throw err;
      const delay = computeDelayMs(attempt, err, {
        baseMs: opts.baseMs,
        maxMs: opts.maxMs,
        jitter: opts.jitter,
        random: opts.random,
        now: clock(),
      });
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
