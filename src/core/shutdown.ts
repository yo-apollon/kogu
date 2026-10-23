/**
 * Shutdown gracioso.
 *
 * Ordem: (1) flag "nao aceitar mais comandos" -> (2) drena o trabalho em andamento por ate
 * 10 s -> (3) hooks registrados com `onShutdown`, em ordem de registro (workers, client.destroy,
 * kv quit, closeDb...) -> (4) `exit`.
 *
 * `unhandledRejection` / `uncaughtException` logam e encerram com codigo 1 (sem drenar).
 * Um segundo sinal durante o shutdown forca a saida.
 */
import { childLogger } from "../lib/logger.js";

const log = childLogger("core:shutdown");

export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
export const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

type Hook = { name: string; fn: () => void | Promise<void> };

export interface ShutdownManagerOptions {
  drainTimeoutMs?: number;
  hookTimeoutMs?: number;
  /** Substituivel em testes; padrao `process.exit`. */
  exit?: (code: number) => void;
}

export interface ShutdownRunOptions {
  code?: number;
  /** Sobrescreve o tempo de drenagem (0 = nao espera). */
  drainTimeoutMs?: number;
}

export interface ShutdownManager {
  onShutdown(name: string, fn: () => void | Promise<void>): void;
  isShuttingDown(): boolean;
  /** Marca inicio de um trabalho (comando). Devolve a funcao que o encerra. */
  beginWork(): () => void;
  inflight(): number;
  shutdown(reason: string, options?: ShutdownRunOptions): Promise<void>;
  /** Registra SIGTERM/SIGINT/unhandledRejection/uncaughtException no `process`. */
  installProcessHandlers(): () => void;
}

export function createShutdownManager(options: ShutdownManagerOptions = {}): ShutdownManager {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const hookTimeoutMs = options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  const hooks: Hook[] = [];
  let shuttingDown = false;
  let running: Promise<void> | null = null;
  let active = 0;
  let idleWaiters: Array<() => void> = [];

  function beginWork(): () => void {
    active++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      active--;
      if (active === 0) {
        const waiters = idleWaiters;
        idleWaiters = [];
        for (const w of waiters) w();
      }
    };
  }

  function drain(timeoutMs: number): Promise<boolean> {
    if (active === 0) return Promise.resolve(true);
    if (timeoutMs <= 0) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        idleWaiters = idleWaiters.filter((w) => w !== onIdle);
        resolve(false);
      }, timeoutMs);
      const onIdle = () => {
        clearTimeout(timer);
        resolve(true);
      };
      idleWaiters.push(onIdle);
    });
  }

  async function runHook(hook: Hook): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), hookTimeoutMs);
    });
    try {
      const outcome = await Promise.race([
        (async () => {
          await hook.fn();
          return "ok" as const;
        })(),
        timeout,
      ]);
      if (outcome === "timeout") log.warn({ hook: hook.name }, "hook de shutdown excedeu o tempo");
      else log.info({ hook: hook.name }, "hook de shutdown concluido");
    } catch (err) {
      log.error({ err, hook: hook.name }, "hook de shutdown falhou");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function shutdown(reason: string, runOptions: ShutdownRunOptions = {}): Promise<void> {
    if (running) return running;
    shuttingDown = true;
    const code = runOptions.code ?? 0;
    running = (async () => {
      log.info({ reason, inflight: active }, "encerrando");
      const drained = await drain(runOptions.drainTimeoutMs ?? drainTimeoutMs);
      if (!drained && active > 0) {
        log.warn({ inflight: active }, "drenagem expirou com trabalho em andamento");
      }
      for (const hook of hooks) await runHook(hook);
      log.info({ code }, "shutdown concluido");
      exit(code);
    })();
    return running;
  }

  function installProcessHandlers(): () => void {
    const onSignal = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        log.warn({ signal }, "segundo sinal recebido; forcando saida");
        exit(1);
        return;
      }
      void shutdown(signal);
    };
    const fatal = (kind: string) => (err: unknown) => {
      log.fatal({ err }, `${kind}; encerrando`);
      // Estado possivelmente corrompido: nao espera comandos em andamento, mas tenta fechar recursos.
      const force = setTimeout(() => exit(1), hookTimeoutMs + 1_000);
      force.unref();
      void shutdown(kind, { code: 1, drainTimeoutMs: 0 });
    };
    const onRejection = fatal("unhandledRejection");
    const onException = fatal("uncaughtException");

    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    process.on("unhandledRejection", onRejection);
    process.on("uncaughtException", onException);
    return () => {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      process.off("unhandledRejection", onRejection);
      process.off("uncaughtException", onException);
    };
  }

  return {
    onShutdown(name, fn) {
      hooks.push({ name, fn });
    },
    isShuttingDown: () => shuttingDown,
    beginWork,
    inflight: () => active,
    shutdown,
    installProcessHandlers,
  };
}

/** Instancia global do processo. */
export const shutdownManager = createShutdownManager();

export const onShutdown = shutdownManager.onShutdown;
export const isShuttingDown = shutdownManager.isShuttingDown;
export const beginWork = shutdownManager.beginWork;
export const installProcessHandlers = shutdownManager.installProcessHandlers;
export const shutdown = shutdownManager.shutdown;
