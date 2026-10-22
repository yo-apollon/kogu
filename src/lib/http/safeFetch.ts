import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_FETCH_TIMEOUT_MS,
  IMAGE_HOST_ALLOWLIST,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_REDIRECTS,
} from "../../config/constants.js";
import { parseRetryAfter } from "./retry.js";

export type SafeFetchErrorCode =
  | "BLOCKED_HOST"
  | "BLOCKED_IP"
  | "BAD_SCHEME"
  | "TOO_LARGE"
  | "BAD_CONTENT_TYPE"
  | "TOO_MANY_REDIRECTS"
  | "TIMEOUT"
  | "HTTP_ERROR";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  /** Status HTTP quando code === "HTTP_ERROR" e houve resposta. */
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    code: SafeFetchErrorCode,
    message: string,
    extra: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "SafeFetchError";
    this.code = code;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.retryAfterMs !== undefined) this.retryAfterMs = extra.retryAfterMs;
  }
}

export const JSON_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_USER_AGENT = "ArqonBot/2.0 (Discord gacha bot; safe-fetch)";

export type LookupResult = Array<{ address: string; family?: number }>;
export type LookupFn = (hostname: string) => Promise<LookupResult>;
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/* ------------------------------------------------------------------ */
/* Checagem de IP                                                      */
/* ------------------------------------------------------------------ */

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const rest = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateV4(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF + TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reservado + broadcast
  return false;
}

/**
 * true se o IP e privado, loopback, link-local, CGNAT, multicast, reservado ou metadata.
 * Entrada que nao e IP valido tambem retorna true (falha fechada).
 */
export function isPrivateIp(ip: string): boolean {
  let s = ip.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  const family = isIP(s);
  if (family === 4) {
    const o = parseIPv4(s);
    return o === null ? true : isPrivateV4(o);
  }
  if (family === 6) {
    const g = parseIPv6(s);
    if (g === null) return true;
    const v4From = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
    // :: (nao especificado), ::1 e demais ::/96 (IPv4-compativel) bloqueados.
    if (g.slice(0, 6).every((x) => x === 0)) return true;
    // ::ffff:a.b.c.d (IPv4 mapeado)
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateV4(v4From(g[6], g[7]));
    // 64:ff9b::/96 (NAT64)
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
      return isPrivateV4(v4From(g[6], g[7]));
    }
    if (g[0] === 0x2002) return isPrivateV4(v4From(g[1], g[2])); // 6to4
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
    if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentacao
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Nucleo: requisicao protegida com redirects manuais                  */
/* ------------------------------------------------------------------ */

interface GuardConfig {
  allowHosts: readonly string[];
  allowAnyPublicHost: boolean;
  fetchImpl: FetchFn;
  lookupImpl: LookupFn;
  timeoutMs: number;
  maxRedirects: number;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {}
}

function normalizeHost(host: string): string {
  let h = host.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

async function assertUrlAllowed(url: URL, cfg: GuardConfig, signal: AbortSignal): Promise<void> {
  if (url.protocol !== "https:") {
    throw new SafeFetchError("BAD_SCHEME", `only https is allowed (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new SafeFetchError("BAD_SCHEME", "credentials in URL are not allowed");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new SafeFetchError("BLOCKED_HOST", `port ${url.port} is not allowed`);
  }
  const host = normalizeHost(url.hostname);
  if (host === "") throw new SafeFetchError("BLOCKED_HOST", "empty host");

  if (!cfg.allowAnyPublicHost) {
    const allowed = cfg.allowHosts.some((h) => normalizeHost(h) === host);
    if (!allowed) throw new SafeFetchError("BLOCKED_HOST", `host not in allowlist: ${host}`);
  }

  // Literal de IP: checa direto, sem DNS. (URL ja normaliza formas como 2130706433.)
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) throw new SafeFetchError("BLOCKED_IP", `blocked IP: ${host}`);
    return;
  }

  let addrs: LookupResult;
  try {
    addrs = await withAbort(cfg.lookupImpl(host), signal);
  } catch (err) {
    if (signal.aborted) throw err;
    throw new SafeFetchError("BLOCKED_HOST", `DNS lookup failed for ${host}`, { cause: err });
  }
  if (addrs.length === 0) throw new SafeFetchError("BLOCKED_HOST", `no DNS records for ${host}`);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new SafeFetchError("BLOCKED_IP", `${host} resolves to blocked IP ${a.address}`);
    }
  }
}

async function guardedRequest(
  rawUrl: string,
  cfg: GuardConfig,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: string }> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch (err) {
    throw new SafeFetchError("BAD_SCHEME", "invalid URL", { cause: err });
  }
  let method = cfg.method;
  let body = cfg.body;
  let headers = cfg.headers;

  for (let hop = 0; ; hop++) {
    await assertUrlAllowed(current, cfg, signal);
    const response = await cfg.fetchImpl(current.href, { method, headers, body, redirect: "manual", signal });

    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: current.href };

    const location = response.headers.get("location");
    await discard(response);
    if (!location) {
      throw new SafeFetchError("HTTP_ERROR", `redirect ${response.status} without Location`, {
        status: response.status,
      });
    }
    if (hop >= cfg.maxRedirects) {
      throw new SafeFetchError("TOO_MANY_REDIRECTS", `more than ${cfg.maxRedirects} redirects`);
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch (err) {
      throw new SafeFetchError("BAD_SCHEME", "invalid redirect Location", { cause: err });
    }
    // 301/302/303 com metodo nao-GET viram GET sem corpo.
    if (response.status !== 307 && response.status !== 308 && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
    }
    // Troca de origem: nao vaza headers customizados (Authorization, API keys).
    if (next.origin !== current.origin) {
      const keep: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === "user-agent" || k.toLowerCase() === "accept") keep[k] = v;
      }
      headers = keep;
    }
    current = next;
  }
}

async function run<T>(
  url: string,
  cfg: GuardConfig,
  handle: (response: Response, finalUrl: string) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, cfg.timeoutMs);
  let response: Response | undefined;
  try {
    const r = await guardedRequest(url, cfg, controller.signal);
    response = r.response;
    return await handle(r.response, r.finalUrl);
  } catch (err) {
    if (response) await discard(response);
    if (timedOut) throw new SafeFetchError("TIMEOUT", `timeout after ${cfg.timeoutMs}ms`, { cause: err });
    if (err instanceof SafeFetchError) throw err;
    throw new SafeFetchError("HTTP_ERROR", `request failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

function assertOkStatus(response: Response): void {
  if (response.status >= 200 && response.status < 300) return;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  throw new SafeFetchError("HTTP_ERROR", `HTTP ${response.status}`, {
    status: response.status,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}

/** Le o corpo respeitando o limite; aborta o stream assim que ultrapassar. */
async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) {
    throw new SafeFetchError("TOO_LARGE", `Content-Length ${declared} exceeds ${maxBytes}`);
  }
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) throw new SafeFetchError("TOO_LARGE", `body exceeds ${maxBytes} bytes`);
    return buf;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new SafeFetchError("TOO_LARGE", `body exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch (err) {
    try {
      await reader.cancel();
    } catch {}
    throw err;
  }
  return Buffer.concat(chunks, total);
}

/* ------------------------------------------------------------------ */
/* API publica                                                         */
/* ------------------------------------------------------------------ */

export interface SafeFetchBaseOptions {
  fetchImpl?: FetchFn;
  lookupImpl?: LookupFn;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
}

export interface SafeFetchImageOptions extends SafeFetchBaseOptions {
  /** Sobrescreve a allowlist de hosts (padrao: IMAGE_HOST_ALLOWLIST). */
  allowHosts?: readonly string[];
  /** Para URLs enviadas por usuarios: ignora a allowlist, mas exige IP publico. */
  allowAnyPublicHost?: boolean;
}

export interface SafeFetchImageResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

export async function safeFetchImage(url: string, opts: SafeFetchImageOptions = {}): Promise<SafeFetchImageResult> {
  const maxBytes = opts.maxBytes ?? IMAGE_MAX_BYTES;
  const cfg: GuardConfig = {
    allowHosts: opts.allowHosts ?? IMAGE_HOST_ALLOWLIST,
    allowAnyPublicHost: opts.allowAnyPublicHost ?? false,
    fetchImpl: opts.fetchImpl ?? ((input, init) => fetch(input, init)),
    lookupImpl: opts.lookupImpl ?? defaultLookup,
    timeoutMs: opts.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS,
    maxRedirects: opts.maxRedirects ?? IMAGE_MAX_REDIRECTS,
    method: "GET",
    headers: { "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT, accept: "image/*" },
  };

  return run(url, cfg, async (response, finalUrl) => {
    assertOkStatus(response);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      throw new SafeFetchError("BAD_CONTENT_TYPE", `content-type not allowed: ${contentType || "(none)"}`);
    }
    const buffer = await readLimited(response, maxBytes);
    return { buffer, contentType, finalUrl };
  });
}

export interface SafeFetchJsonOptions extends SafeFetchBaseOptions {
  /** Hosts da API permitidos (obrigatorio). */
  allowHosts: readonly string[];
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface SafeFetchJsonResult<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
  finalUrl: string;
}

export async function safeFetchJson<T = unknown>(
  url: string,
  opts: SafeFetchJsonOptions,
): Promise<SafeFetchJsonResult<T>> {
  const maxBytes = opts.maxBytes ?? JSON_MAX_BYTES;
  const cfg: GuardConfig = {
    allowHosts: opts.allowHosts,
    allowAnyPublicHost: false,
    fetchImpl: opts.fetchImpl ?? ((input, init) => fetch(input, init)),
    lookupImpl: opts.lookupImpl ?? defaultLookup,
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxRedirects: opts.maxRedirects ?? IMAGE_MAX_REDIRECTS,
    method: (opts.method ?? "GET").toUpperCase(),
    headers: {
      "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
      accept: "application/json",
      ...opts.headers,
    },
    body: opts.body,
  };

  return run(url, cfg, async (response, finalUrl) => {
    assertOkStatus(response);
    const raw = await readLimited(response, maxBytes);
    let data: T;
    try {
      data = JSON.parse(new TextDecoder("utf-8").decode(raw)) as T;
    } catch (err) {
      throw new SafeFetchError("HTTP_ERROR", "invalid JSON response", { status: response.status, cause: err });
    }
    return { data, status: response.status, headers: response.headers, finalUrl };
  });
}
