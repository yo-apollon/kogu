import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { createShutdownManager } from "../../../src/core/shutdown.js";
import { sleep } from "../../../src/lib/time.js";

function setup(options: { drainTimeoutMs?: number; hookTimeoutMs?: number } = {}) {
  const exit = vi.fn();
  const manager = createShutdownManager({ ...options, exit });
  return { manager, exit };
}

describe("shutdown", () => {
  it("executa os hooks na ordem de registro, depois sai com codigo 0, em bem menos de 10 s", async () => {
    const { manager, exit } = setup();
    const order: string[] = [];
    manager.onShutdown("workers", async () => {
      await sleep(30);
      order.push("workers");
    });
    manager.onShutdown("client", () => {
      order.push("client");
    });
    manager.onShutdown("kv", async () => {
      order.push("kv");
    });
    manager.onShutdown("db", async () => {
      order.push("db");
    });

    const started = Date.now();
    await manager.shutdown("SIGTERM");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(order).toEqual(["workers", "client", "kv", "db"]);
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("para de aceitar trabalho assim que o shutdown comeca", async () => {
    const { manager } = setup();
    expect(manager.isShuttingDown()).toBe(false);
    const pending = manager.shutdown("test");
    expect(manager.isShuttingDown()).toBe(true);
    await pending;
  });

  it("drena o trabalho em andamento antes de rodar os hooks", async () => {
    const { manager } = setup();
    const events: string[] = [];
    manager.onShutdown("hook", () => {
      events.push("hook");
    });
    const end = manager.beginWork();
    expect(manager.inflight()).toBe(1);

    const pending = manager.shutdown("test");
    await sleep(60);
    expect(events).toEqual([]); // ainda drenando
    events.push("work-done");
    end();
    await pending;
    expect(events).toEqual(["work-done", "hook"]);
    expect(manager.inflight()).toBe(0);
  });

  it("encerra a drenagem no prazo mesmo com trabalho travado", async () => {
    const { manager, exit } = setup({ drainTimeoutMs: 100 });
    const hook = vi.fn();
    manager.onShutdown("hook", hook);
    manager.beginWork(); // nunca termina
    const started = Date.now();
    await manager.shutdown("test");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(2_000);
    expect(hook).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("hook que falha ou trava nao impede os seguintes", async () => {
    const { manager, exit } = setup({ hookTimeoutMs: 80 });
    const ran: string[] = [];
    manager.onShutdown("falha", () => {
      throw new Error("x");
    });
    manager.onShutdown("trava", () => new Promise<void>(() => {}));
    manager.onShutdown("ok", () => {
      ran.push("ok");
    });
    const started = Date.now();
    await manager.shutdown("test");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(ran).toEqual(["ok"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("e idempotente: chamadas repetidas rodam os hooks uma vez", async () => {
    const { manager, exit } = setup();
    const hook = vi.fn();
    manager.onShutdown("hook", hook);
    await Promise.all([manager.shutdown("a"), manager.shutdown("b")]);
    await manager.shutdown("c");
    expect(hook).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("codigo 1 sem drenar (uncaughtException / unhandledRejection)", async () => {
    const { manager, exit } = setup();
    manager.beginWork(); // trabalho pendente nao deve atrasar
    const hook = vi.fn();
    manager.onShutdown("hook", hook);
    const started = Date.now();
    await manager.shutdown("uncaughtException", { code: 1, drainTimeoutMs: 0 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(hook).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("endWork repetido nao corrompe o contador", () => {
    const { manager } = setup();
    const end = manager.beginWork();
    manager.beginWork();
    end();
    end();
    expect(manager.inflight()).toBe(1);
  });

  it("installProcessHandlers registra e remove os listeners de sinais/erros", () => {
    const { manager } = setup();
    const events = ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"] as const;
    const before = events.map((e) => process.listenerCount(e));
    const uninstall = manager.installProcessHandlers();
    events.forEach((e, i) => expect(process.listenerCount(e)).toBe(before[i]! + 1));
    uninstall();
    events.forEach((e, i) => expect(process.listenerCount(e)).toBe(before[i]));
  });
});
