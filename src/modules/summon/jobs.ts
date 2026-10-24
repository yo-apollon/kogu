/**
 * Sweeper de ofertas (`offers.sweep`, 30 s, no processo do bot).
 *
 * A cada tick: `sweepExpiredOffers()` marca como EXPIRED as ofertas OPEN vencidas (lotes com
 * SKIP LOCKED: varios processos nao disputam as mesmas linhas) e este job desabilita os botoes
 * das mensagens correspondentes.
 *
 *  - Oferta sem `message_id` (envio falhou): nada a editar.
 *  - Orbe ja absorvido: a mensagem ja foi atualizada no clique com o rotulo "absorvido"
 *    (`orbDoneRow`); nao a sobrescrevemos com "dissipada".
 *  - Falha ao editar (mensagem/canal apagado, sem permissao, rate limit): logada e ignorada.
 *    A oferta ja esta EXPIRED no banco, entao um clique tardio recebe `errors.expired`.
 *
 * USO (o orquestrador liga em src/index.ts, depois do evento ClientReady):
 *
 *   const stopSweeper = jobs.startSummonSweeper(client, kv);
 *   onShutdown("summon-sweeper", stopSweeper);
 *
 * `kv` e opcional: com ele, so uma instancia varre por vez (lock curto); sem ele todas varrem,
 * o que continua correto por causa do SKIP LOCKED. Ticks nao se sobrepoem e so rodam com o
 * client pronto (senao as ofertas seriam expiradas sem poder editar as mensagens).
 */
import type { Client } from "discord.js";
import type { Locale } from "../../config/constants.js";
import { DEFAULT_LOCALE } from "../../config/constants.js";
import type { KV } from "../../infra/redis/kv.js";
import { tryLock } from "../../infra/redis/locks.js";
import { childLogger } from "../../lib/logger.js";
import { sweepExpiredOffers, type ExpiredOffer } from "./offers.js";
import { expiredRow, guildLocales } from "./views.js";

const log = childLogger("summon:sweeper");

export const SWEEP_INTERVAL_MS = 30_000;
/** Primeiro tick logo apos o start: pega ofertas que venceram com o bot fora do ar. */
export const SWEEP_INITIAL_DELAY_MS = 5_000;
export const SWEEP_LOCK_KEY = "lock:summon:sweep";
const SWEEP_LOCK_TTL_MS = 60_000;
const EDIT_CONCURRENCY = 4;

/** Codigos do Discord esperados quando a mensagem/canal sumiu ou nao temos acesso. */
const EXPECTED_EDIT_ERRORS = new Set<number>([10003, 10008, 50001, 50013]);

export interface SweepDeps {
  sweep(): Promise<ExpiredOffer[]>;
  locales(guildIds: readonly string[]): Promise<Map<string, Locale>>;
}

const defaultSweepDeps: SweepDeps = {
  sweep: () => sweepExpiredOffers(),
  locales: guildLocales,
};

export interface SweepStats {
  /** Ofertas marcadas como EXPIRED neste tick. */
  expired: number;
  /** Mensagens editadas. */
  edited: number;
  /** Edicoes que falharam (ignoradas). */
  failed: number;
  /** Ofertas sem nada a editar (sem mensagem ou orbe ja absorvido). */
  skipped: number;
}

async function resolveChannel(client: Client, channelId: string) {
  const cached = client.channels.cache.get(channelId);
  if (cached) return cached;
  return client.channels.fetch(channelId).catch(() => null);
}

/** Um tick do sweeper. Exportado para testes e para uma varredura manual. */
export async function runSweepOnce(
  client: Client,
  deps: SweepDeps = defaultSweepDeps
): Promise<SweepStats> {
  const offers = await deps.sweep();
  const stats: SweepStats = { expired: offers.length, edited: 0, failed: 0, skipped: 0 };
  if (offers.length === 0) return stats;

  const toEdit: Array<ExpiredOffer & { messageId: string }> = [];
  for (const offer of offers) {
    if (offer.messageId === null || offer.orbClaimedBy !== null) stats.skipped++;
    else toEdit.push({ ...offer, messageId: offer.messageId });
  }

  const locales = await deps.locales([...new Set(toEdit.map((o) => o.guildId))]).catch(() => new Map<string, Locale>());

  const editOne = async (offer: ExpiredOffer & { messageId: string }): Promise<void> => {
    try {
      const channel = await resolveChannel(client, offer.channelId);
      if (!channel || !channel.isTextBased()) {
        stats.failed++;
        log.debug({ offerId: offer.id, channelId: offer.channelId }, "canal da oferta indisponivel");
        return;
      }
      await channel.messages.edit(offer.messageId, {
        components: [expiredRow(offer.id, locales.get(offer.guildId) ?? DEFAULT_LOCALE)],
        allowedMentions: { parse: [] },
      });
      stats.edited++;
    } catch (err) {
      stats.failed++;
      const code = (err as { code?: unknown } | null)?.code;
      const expected = typeof code === "number" && EXPECTED_EDIT_ERRORS.has(code);
      (expected ? log.debug : log.warn).call(
        log,
        { err, offerId: offer.id, channelId: offer.channelId, code },
        "nao foi possivel desabilitar os botoes da oferta"
      );
    }
  };

  // Pool pequeno: o REST do discord.js ja enfileira por rota, isto so evita milhares de promessas.
  let next = 0;
  const workers = Array.from({ length: Math.min(EDIT_CONCURRENCY, toEdit.length) }, async () => {
    while (next < toEdit.length) await editOne(toEdit[next++]);
  });
  await Promise.all(workers);

  log.debug(stats, "sweep de ofertas concluido");
  return stats;
}

export interface SweeperOptions {
  intervalMs?: number;
  initialDelayMs?: number;
  /** Substituivel em testes. */
  deps?: SweepDeps;
}

/** Funcao de parada: cancela os timers e espera o tick em andamento terminar. */
export type StopSweeper = () => Promise<void>;

export function startSummonSweeper(
  client: Client,
  kv?: KV,
  options: SweeperOptions = {}
): StopSweeper {
  const intervalMs = options.intervalMs ?? SWEEP_INTERVAL_MS;
  const deps = options.deps ?? defaultSweepDeps;
  let stopped = false;
  let current: Promise<void> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped || current || !client.isReady()) return;
    const run = (async () => {
      let release: (() => Promise<boolean>) | null = null;
      try {
        if (kv) {
          try {
            const lock = await tryLock(kv, SWEEP_LOCK_KEY, SWEEP_LOCK_TTL_MS);
            if (!lock.acquired) return;
            release = lock.release;
          } catch (err) {
            // Sem KV seguimos: o SKIP LOCKED do banco garante a correcao.
            log.warn({ err }, "lock do sweeper indisponivel; varrendo sem lock");
          }
        }
        await runSweepOnce(client, deps);
      } catch (err) {
        log.error({ err }, "falha no sweep de ofertas");
      } finally {
        if (release) await release().catch(() => undefined);
      }
    })();
    current = run;
    try {
      await run;
    } finally {
      current = null;
    }
  };

  const interval = setInterval(() => void tick(), intervalMs);
  const first = setTimeout(() => void tick(), options.initialDelayMs ?? SWEEP_INITIAL_DELAY_MS);
  interval.unref();
  first.unref();

  return async () => {
    stopped = true;
    clearInterval(interval);
    clearTimeout(first);
    if (current) await current;
  };
}
