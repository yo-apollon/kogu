import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FetchFn,
  type LookupFn,
  SafeFetchError,
  isPrivateIp,
  safeFetchImage,
  safeFetchJson,
} from "../../../src/lib/http/safeFetch.js";

const PUBLIC = "93.184.216.34";
const HOST = "s4.anilist.co";
const URL_OK = `https://${HOST}/img/a.png`;

const lookupPublic: LookupFn = async () => [{ address: PUBLIC, family: 4 }];

function img(body: Uint8Array | string = "PNGDATA", type = "image/png", extra: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers: { "content-type": type, ...extra } });
}

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(SafeFetchError);
  expect((err as SafeFetchError).code).toBe(code);
  return err as SafeFetchError;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "0.1.2.3",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "[::1]",
    "not-an-ip",
  ])("bloqueia %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.0.1",
    "2606:2800:220:1:248:1893:25c8:1946",
    "::ffff:8.8.8.8",
    "2001:4860:4860::8888",
  ])("permite %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("safeFetchImage", () => {
  it("baixa imagem valida e devolve buffer, contentType e finalUrl", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => img("PNGDATA", "image/png; charset=binary"));
    const r = await safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic });
    expect(r.buffer.toString()).toBe("PNGDATA");
    expect(r.contentType).toBe("image/png");
    expect(r.finalUrl).toBe(URL_OK);
    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/Kogu/);
  });

  it("bloqueia http (nao-https)", async () => {
    const fetchImpl = vi.fn<FetchFn>();
    await expectCode(safeFetchImage(`http://${HOST}/a.png`, { fetchImpl, lookupImpl: lookupPublic }), "BAD_SCHEME");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bloqueia URL invalida e credenciais na URL", async () => {
    const opts = { fetchImpl: vi.fn<FetchFn>(), lookupImpl: lookupPublic };
    await expectCode(safeFetchImage("nao e url", opts), "BAD_SCHEME");
    await expectCode(safeFetchImage(`https://user:pw@${HOST}/a.png`, opts), "BAD_SCHEME");
    await expectCode(safeFetchImage(`https://${HOST}:8443/a.png`, opts), "BLOCKED_HOST");
  });

  it("bloqueia host fora da allowlist", async () => {
    const fetchImpl = vi.fn<FetchFn>();
    const lookupImpl = vi.fn<LookupFn>(lookupPublic);
    await expectCode(safeFetchImage("https://evil.example.com/a.png", { fetchImpl, lookupImpl }), "BLOCKED_HOST");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lookupImpl).not.toHaveBeenCalled();
  });

  it("allowHosts sobrescreve a allowlist", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => img());
    const r = await safeFetchImage("https://cdn.example.com/a.png", {
      fetchImpl,
      lookupImpl: lookupPublic,
      allowHosts: ["cdn.example.com"],
    });
    expect(r.finalUrl).toBe("https://cdn.example.com/a.png");
  });

  it("allowAnyPublicHost aceita host publico mas ainda checa IP", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => img());
    const ok = await safeFetchImage("https://random.example.org/a.png", {
      fetchImpl,
      lookupImpl: lookupPublic,
      allowAnyPublicHost: true,
    });
    expect(ok.buffer.length).toBeGreaterThan(0);

    const lookupPrivate: LookupFn = async () => [{ address: "10.0.0.5", family: 4 }];
    await expectCode(
      safeFetchImage("https://random.example.org/a.png", {
        fetchImpl,
        lookupImpl: lookupPrivate,
        allowAnyPublicHost: true,
      }),
      "BLOCKED_IP",
    );
  });

  it.each([
    ["127.0.0.1", "https://127.0.0.1/a.png"],
    ["169.254.169.254", "https://169.254.169.254/latest/meta-data"],
    ["10.0.0.1", "https://10.0.0.1/a.png"],
    ["192.168.1.1", "https://192.168.1.1/a.png"],
    ["::1", "https://[::1]/a.png"],
    ["IPv4 decimal", "https://2130706433/a.png"],
  ])("bloqueia IP literal %s (allowAnyPublicHost)", async (_n, url) => {
    const fetchImpl = vi.fn<FetchFn>();
    await expectCode(
      safeFetchImage(url, { fetchImpl, lookupImpl: lookupPublic, allowAnyPublicHost: true }),
      "BLOCKED_IP",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "192.168.1.1", "::1", "::ffff:7f00:1"])(
    "bloqueia host da allowlist que resolve para %s (DNS)",
    async (address) => {
      const fetchImpl = vi.fn<FetchFn>();
      const lookupImpl: LookupFn = async () => [{ address }];
      await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl }), "BLOCKED_IP");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("bloqueia se QUALQUER registro DNS for privado", async () => {
    const lookupImpl: LookupFn = async () => [{ address: PUBLIC }, { address: "127.0.0.1" }];
    await expectCode(safeFetchImage(URL_OK, { fetchImpl: vi.fn<FetchFn>(), lookupImpl }), "BLOCKED_IP");
  });

  it("falha de DNS vira BLOCKED_HOST", async () => {
    const lookupImpl: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    await expectCode(safeFetchImage(URL_OK, { fetchImpl: vi.fn<FetchFn>(), lookupImpl }), "BLOCKED_HOST");
  });

  it("bloqueia redirect para IP privado", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => redirect("https://169.254.169.254/latest/meta-data"));
    await expectCode(
      safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic, allowAnyPublicHost: true }),
      "BLOCKED_IP",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bloqueia redirect para host fora da allowlist", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => redirect("https://internal.corp/a.png"));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "BLOCKED_HOST");
  });

  it("bloqueia redirect cujo DNS resolve para IP privado", async () => {
    const lookupImpl: LookupFn = async (h) =>
      h === "cdn.myanimelist.net" ? [{ address: "192.168.0.10" }] : [{ address: PUBLIC }];
    const fetchImpl = vi.fn<FetchFn>(async () => redirect("https://cdn.myanimelist.net/a.png"));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl }), "BLOCKED_IP");
  });

  it("bloqueia redirect para http", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => redirect(`http://${HOST}/a.png`));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "BAD_SCHEME");
  });

  it("segue redirect valido (relativo) e reporta finalUrl", async () => {
    const fetchImpl = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(redirect("/final/b.png", 301))
      .mockResolvedValueOnce(img());
    const r = await safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic });
    expect(r.finalUrl).toBe(`https://${HOST}/final/b.png`);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("limita redirects (padrao 2)", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => redirect(`https://${HOST}/loop`));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "TOO_MANY_REDIRECTS");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("redirect sem Location vira HTTP_ERROR", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => new Response(null, { status: 302 }));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "HTTP_ERROR");
  });

  it("rejeita text/html", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => img("<html></html>", "text/html; charset=utf-8"));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "BAD_CONTENT_TYPE");
  });

  it("rejeita ausencia de Content-Type e image/svg+xml", async () => {
    const none = vi.fn<FetchFn>(async () => new Response("x"));
    // Response(string) define text/plain por padrao; remove o header de fato.
    const noType = vi.fn<FetchFn>(async () => {
      const r = new Response("x");
      r.headers.delete("content-type");
      return r;
    });
    await expectCode(safeFetchImage(URL_OK, { fetchImpl: none, lookupImpl: lookupPublic }), "BAD_CONTENT_TYPE");
    await expectCode(safeFetchImage(URL_OK, { fetchImpl: noType, lookupImpl: lookupPublic }), "BAD_CONTENT_TYPE");
    const svg = vi.fn<FetchFn>(async () => img("<svg/>", "image/svg+xml"));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl: svg, lookupImpl: lookupPublic }), "BAD_CONTENT_TYPE");
  });

  it("rejeita por Content-Length acima de 8 MB sem ler o corpo", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => img("x", "image/png", { "content-length": String(9 * 1024 * 1024) }));
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "TOO_LARGE");
  });

  it("aborta o stream ao passar de 8 MB sem Content-Length", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 50) return controller.close();
        controller.enqueue(chunk);
      },
    });
    const fetchImpl = vi.fn<FetchFn>(
      async () => new Response(stream, { status: 200, headers: { "content-type": "image/png" } }),
    );
    await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "TOO_LARGE");
    expect(pulled).toBeLessThan(15);
  });

  it("aceita corpo exatamente no limite", async () => {
    const body = new Uint8Array(1024);
    const fetchImpl = vi.fn<FetchFn>(async () => img(body));
    const r = await safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic, maxBytes: 1024 });
    expect(r.buffer.length).toBe(1024);
  });

  it("status nao-2xx vira HTTP_ERROR com status e retryAfterMs", async () => {
    const fetchImpl = vi.fn<FetchFn>(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "7" } }),
    );
    const err = await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "HTTP_ERROR");
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(7000);
  });

  it("erro de rede vira HTTP_ERROR sem status", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic }), "HTTP_ERROR");
    expect(err.status).toBeUndefined();
  });

  it("estoura timeout via AbortController", async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchFn = (_u, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const p = safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic });
    const assertion = expectCode(p, "TIMEOUT");
    await vi.advanceTimersByTimeAsync(6001);
    await assertion;
  });

  it("estoura timeout no meio da leitura do corpo", async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchFn = async (_u, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init!.signal!.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "image/png" } });
    };
    const assertion = expectCode(safeFetchImage(URL_OK, { fetchImpl, lookupImpl: lookupPublic, timeoutMs: 500 }), "TIMEOUT");
    await vi.advanceTimersByTimeAsync(501);
    await assertion;
  });

  it("estoura timeout durante o DNS", async () => {
    vi.useFakeTimers();
    const lookupImpl: LookupFn = () => new Promise(() => {});
    const assertion = expectCode(
      safeFetchImage(URL_OK, { fetchImpl: vi.fn<FetchFn>(), lookupImpl, timeoutMs: 100 }),
      "TIMEOUT",
    );
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });
});

describe("safeFetchJson", () => {
  const API = "https://graphql.anilist.co/";
  const allowHosts = ["graphql.anilist.co"];
  const json = (data: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" }, ...init });

  it("parseia JSON e expoe status e headers", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () =>
      json({ ok: true }, { headers: { "x-ratelimit-remaining": "42", "content-type": "application/json" } }),
    );
    const r = await safeFetchJson<{ ok: boolean }>(API, { allowHosts, fetchImpl, lookupImpl: lookupPublic });
    expect(r.data).toEqual({ ok: true });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-ratelimit-remaining")).toBe("42");
  });

  it("envia POST com corpo e headers", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => json({}));
    await safeFetchJson(API, {
      allowHosts,
      fetchImpl,
      lookupImpl: lookupPublic,
      method: "post",
      body: '{"query":"x"}',
      headers: { "content-type": "application/json" },
    });
    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"query":"x"}');
  });

  it("exige https, allowlist e IP publico", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => json({}));
    await expectCode(
      safeFetchJson("http://graphql.anilist.co/", { allowHosts, fetchImpl, lookupImpl: lookupPublic }),
      "BAD_SCHEME",
    );
    await expectCode(
      safeFetchJson("https://other.example.com/", { allowHosts, fetchImpl, lookupImpl: lookupPublic }),
      "BLOCKED_HOST",
    );
    await expectCode(
      safeFetchJson(API, { allowHosts, fetchImpl, lookupImpl: async () => [{ address: "127.0.0.1" }] }),
      "BLOCKED_IP",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("limita a 5 MB", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () =>
      json({}, { headers: { "content-length": String(6 * 1024 * 1024), "content-type": "application/json" } }),
    );
    await expectCode(safeFetchJson(API, { allowHosts, fetchImpl, lookupImpl: lookupPublic }), "TOO_LARGE");
  });

  it("429 vira HTTP_ERROR com retryAfterMs (data HTTP)", async () => {
    const when = new Date(Date.now() + 30_000).toUTCString();
    const fetchImpl = vi.fn<FetchFn>(async () => new Response("{}", { status: 429, headers: { "retry-after": when } }));
    const err = await expectCode(safeFetchJson(API, { allowHosts, fetchImpl, lookupImpl: lookupPublic }), "HTTP_ERROR");
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBeGreaterThan(20_000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(30_000);
  });

  it("JSON invalido vira HTTP_ERROR", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => new Response("<html>", { status: 200 }));
    await expectCode(safeFetchJson(API, { allowHosts, fetchImpl, lookupImpl: lookupPublic }), "HTTP_ERROR");
  });

  it("nao vaza Authorization em redirect para outra origem", async () => {
    const fetchImpl = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(redirect("https://api.other.com/x", 307))
      .mockResolvedValueOnce(json({ ok: 1 }));
    await safeFetchJson(API, {
      allowHosts: ["graphql.anilist.co", "api.other.com"],
      fetchImpl,
      lookupImpl: lookupPublic,
      headers: { Authorization: "Bearer secret" },
    });
    const first = fetchImpl.mock.calls[0][1]!.headers as Record<string, string>;
    const second = fetchImpl.mock.calls[1][1]!.headers as Record<string, string>;
    expect(first.Authorization).toBe("Bearer secret");
    expect(second.Authorization).toBeUndefined();
    expect(second["user-agent"]).toBeDefined();
  });

  it("timeout configuravel", async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchFn = (_u, init) =>
      new Promise((_r, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const assertion = expectCode(
      safeFetchJson(API, { allowHosts, fetchImpl, lookupImpl: lookupPublic, timeoutMs: 250 }),
      "TIMEOUT",
    );
    await vi.advanceTimersByTimeAsync(251);
    await assertion;
  });
});
