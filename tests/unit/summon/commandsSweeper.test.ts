import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
}));
vi.mock("../../../src/lib/logger.js", () => ({
  logger: logMock,
  childLogger: () => logMock,
}));

import type { Client } from "discord.js";
import type { Locale } from "../../../src/config/constants.js";
import type { KV } from "../../../src/infra/redis/kv.js";
import type { ExpiredOffer } from "../../../src/modules/summon/offers.js";
import {
  runSweepOnce,
  startSummonSweeper,
  SWEEP_INITIAL_DELAY_MS,
  SWEEP_INTERVAL_MS,
  SWEEP_LOCK_KEY,
  type SweepDeps,
} from "../../../src/modules/summon/jobs.js";

function offer(over: Partial<ExpiredOffer> = {}): ExpiredOffer {
  return {
    id: 5,
    guildId: "g1",
    channelId: "c1",
    messageId: "m1",
    entityId: 11,
    ownerUserId: "u1",
    orbAether: null,
    orbClaimedBy: null,
    ...over,
  };
}

function fakeClient(opts: { ready?: boolean; channels?: Record<string, unknown> } = {}) {
  const edit = vi.fn(async (_id: string, _payload: unknown) => ({}));
  const channel = { isTextBased: () => true, messages: { edit } };
  const cache = new Map<string, unknown>(Object.entries(opts.channels ?? { c1: channel }));
  const fetch = vi.fn(async (id: string) => {
    throw Object.assign(new Error(`canal ${id} desconhecido`), { code: 10003 });
  });
  const client = {
    isReady: () => opts.ready ?? true,
    channels: { cache, fetch },
  } as unknown as Client;
  return { client, edit, fetch, channel };
}

function deps(offers: ExpiredOffer[] | (() => Promise<ExpiredOffer[]>), locales: Record<string, Locale> = {}): SweepDeps & {
  sweep: ReturnType<typeof vi.fn>;
} {
  return {
    sweep: vi.fn(typeof offers === "function" ? offers : async () => offers),
    locales: vi.fn(async () => new Map(Object.entries(locales))),
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("runSweepOnce", () => {
  it("desabilita os botoes de oferta expirada sem reivindicacao", async () => {
    const { client, edit } = fakeClient();
    const stats = await runSweepOnce(client, deps([offer()]));

    expect(stats).toEqual({ expired: 1, edited: 1, failed: 0, skipped: 0 });
    expect(edit).toHaveBeenCalledTimes(1);
    const [messageId, payload] = edit.mock.calls[0] as [string, any];
    expect(messageId).toBe("m1");
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0].toJSON().components).toEqual([
      expect.objectContaining({
        custom_id: "sm:expired:5",
        disabled: true,
        label: "Fenda Dimensional Dissipada",
      }),
    ]);
  });

  it("usa o idioma da guild no rotulo", async () => {
    const { client, edit } = fakeClient();
    await runSweepOnce(client, deps([offer()], { g1: "en-US" }));
    const payload = edit.mock.calls[0][1] as any;
    expect(payload.components[0].toJSON().components[0].label).toBe("Dimensional Rift Dissipated");
  });

  it("orbe ja absorvido mantem o rotulo 'absorvido': a mensagem nao e tocada", async () => {
    const { client, edit } = fakeClient();
    const stats = await runSweepOnce(
      client,
      deps([offer({ id: 6, orbAether: 76, orbClaimedBy: "u2" }), offer({ id: 7, messageId: null })])
    );
    expect(edit).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ expired: 2, edited: 0, skipped: 2 });
  });

  it("falhas de edicao sao ignoradas: as demais ofertas continuam", async () => {
    const { client, edit } = fakeClient();
    edit.mockRejectedValueOnce(Object.assign(new Error("Unknown Message"), { code: 10008 }));
    edit.mockRejectedValueOnce(new Error("boom inesperado"));
    const stats = await runSweepOnce(
      client,
      deps([offer({ id: 1, messageId: "a" }), offer({ id: 2, messageId: "b" }), offer({ id: 3, messageId: "c" })])
    );

    expect(stats).toMatchObject({ expired: 3, edited: 1, failed: 2 });
    expect(edit).toHaveBeenCalledTimes(3);
    // 10008 e esperado (debug); o erro desconhecido e logado como warn
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(logMock.debug).toHaveBeenCalled();
  });

  it("canal indisponivel (cache vazio e fetch falha) conta como falha sem lancar", async () => {
    const { client, edit, fetch } = fakeClient({ channels: {} });
    const stats = await runSweepOnce(client, deps([offer()]));
    expect(fetch).toHaveBeenCalledWith("c1");
    expect(edit).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ expired: 1, edited: 0, failed: 1 });
  });

  it("canal que nao e de texto e ignorado", async () => {
    const { client, edit } = fakeClient({ channels: { c1: { isTextBased: () => false } } });
    const stats = await runSweepOnce(client, deps([offer()]));
    expect(edit).not.toHaveBeenCalled();
    expect(stats.failed).toBe(1);
  });

  it("sem ofertas vencidas nao consulta idiomas", async () => {
    const { client } = fakeClient();
    const d = deps([]);
    expect(await runSweepOnce(client, d)).toEqual({ expired: 0, edited: 0, failed: 0, skipped: 0 });
    expect(d.locales).not.toHaveBeenCalled();
  });
});

describe("startSummonSweeper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("varre no primeiro atraso e a cada 30 s; stop encerra", async () => {
    const { client } = fakeClient();
    const d = deps([]);
    const stop = startSummonSweeper(client, undefined, { deps: d });

    await vi.advanceTimersByTimeAsync(SWEEP_INITIAL_DELAY_MS - 1);
    expect(d.sweep).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(d.sweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(d.sweep).toHaveBeenCalledTimes(2);

    await stop();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3);
    expect(d.sweep).toHaveBeenCalledTimes(2);
  });

  it("nao varre com o client fora de ready (nao consome ofertas que nao poderia editar)", async () => {
    const { client } = fakeClient({ ready: false });
    const d = deps([]);
    const stop = startSummonSweeper(client, undefined, { deps: d, intervalMs: 100, initialDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.sweep).not.toHaveBeenCalled();
    await stop();
  });

  it("ticks nao se sobrepoem e stop espera o tick em andamento", async () => {
    const { client } = fakeClient();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const d = deps(async () => {
      await gate;
      return [];
    });
    const stop = startSummonSweeper(client, undefined, { deps: d, intervalMs: 100, initialDelayMs: 10 });

    await vi.advanceTimersByTimeAsync(500);
    expect(d.sweep).toHaveBeenCalledTimes(1); // varios intervalos passaram, mas o tick segue preso

    let stopped = false;
    const stopping = stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("erro no sweep e logado e o proximo tick continua", async () => {
    const { client } = fakeClient();
    const d = deps([]);
    d.sweep.mockRejectedValueOnce(new Error("db fora"));
    const stop = startSummonSweeper(client, undefined, { deps: d, intervalMs: 100, initialDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(logMock.error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(d.sweep).toHaveBeenCalledTimes(2);
    await stop();
  });

  it("com KV: lock ocupado pula o tick; lock obtido varre e libera", async () => {
    const { client } = fakeClient();
    const d = deps([]);
    const kv = {
      acquireLock: vi.fn(async () => null as string | null),
      releaseLock: vi.fn(async () => true),
    } as unknown as KV;
    const stop = startSummonSweeper(client, kv, { deps: d, intervalMs: 100, initialDelayMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    expect(kv.acquireLock).toHaveBeenCalledWith(SWEEP_LOCK_KEY, expect.any(Number));
    expect(d.sweep).not.toHaveBeenCalled();

    (kv.acquireLock as ReturnType<typeof vi.fn>).mockResolvedValue("token-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(d.sweep).toHaveBeenCalledTimes(1);
    expect(kv.releaseLock).toHaveBeenCalledWith(SWEEP_LOCK_KEY, "token-1");
    await stop();
  });

  it("KV indisponivel: varre mesmo assim (o SKIP LOCKED do banco protege)", async () => {
    const { client } = fakeClient();
    const d = deps([]);
    const kv = {
      acquireLock: vi.fn(async () => {
        throw new Error("redis fora");
      }),
      releaseLock: vi.fn(),
    } as unknown as KV;
    const stop = startSummonSweeper(client, kv, { deps: d, intervalMs: 100, initialDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(d.sweep).toHaveBeenCalledTimes(1);
    expect(logMock.warn).toHaveBeenCalled();
    await stop();
  });
});
