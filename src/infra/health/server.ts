/**
 * Servidor HTTP minimo de saude.
 * - `/healthz`: 200 enquanto o processo estiver vivo.
 * - `/readyz`: 200 somente com Discord READY + Postgres (`select 1`) + KV (`PING`); senao 503
 *   com JSON dos checks (apenas "ok"/"fail": nunca detalhes de erro). Durante o shutdown, 503.
 * `HEALTH_PORT=0` desliga o servidor.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { getEnv } from "../../config/env.js";
import { childLogger } from "../../lib/logger.js";
import { handlePortalRoute, type PortalQueryDeps } from "./portal.js";

const log = childLogger("health");

const CHECK_TIMEOUT_MS = 2_000;

export interface HealthDeps extends PortalQueryDeps {
  /** Cliente Discord em estado READY. */
  isDiscordReady(): boolean;
  /** Deve rejeitar se o Postgres nao responder (ex.: `sql\`select 1\``). */
  checkDb(): Promise<unknown>;
  /** KV.ping(); `false` ou rejeicao = falha. */
  pingKv(): Promise<boolean>;
  isShuttingDown?(): boolean;
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

type CheckResult = "ok" | "fail";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

async function run(check: () => Promise<unknown>, expectTrue = false): Promise<CheckResult> {
  try {
    const value = await withTimeout(Promise.resolve().then(check), CHECK_TIMEOUT_MS);
    return expectTrue && value !== true ? "fail" : "ok";
  } catch {
    return "fail";
  }
}

export async function evaluateReadiness(deps: HealthDeps): Promise<{
  ready: boolean;
  checks: Record<"discord" | "postgres" | "redis", CheckResult>;
  shuttingDown: boolean;
}> {
  const shuttingDown = deps.isShuttingDown?.() ?? false;
  const discord: CheckResult = deps.isDiscordReady() ? "ok" : "fail";
  const [postgres, redis] = await Promise.all([run(deps.checkDb), run(deps.pingKv, true)]);
  const checks = { discord, postgres, redis };
  const ready = !shuttingDown && Object.values(checks).every((c) => c === "ok");
  return { ready, checks, shuttingDown };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

/**
 * Sobe o servidor. Retorna `null` quando a porta e 0 (desligado).
 * `port` padrao: `HEALTH_PORT` do ambiente.
 */
export async function startHealthServer(
  deps: HealthDeps,
  options: { port?: number; host?: string } = {}
): Promise<HealthServer | null> {
  const port = options.port ?? getEnv().HEALTH_PORT;
  if (port === 0) {
    log.info("HEALTH_PORT=0: servidor de saude desligado");
    return null;
  }

  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    if (path === "/healthz") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (path === "/readyz") {
      evaluateReadiness(deps).then(
        ({ ready, checks, shuttingDown }) => {
          sendJson(res, ready ? 200 : 503, {
            status: ready ? "ready" : shuttingDown ? "shutting_down" : "unavailable",
            checks,
          });
        },
        (err: unknown) => {
          log.error({ err }, "falha ao avaliar /readyz");
          sendJson(res, 503, { status: "unavailable" });
        }
      );
      return;
    }
    handlePortalRoute(req, res, deps)
      .then((handled) => {
        if (!handled) sendJson(res, 404, { error: "not_found" });
      })
      .catch(() => {
        sendJson(res, 500, { error: "internal_error" });
      });
  });
  server.keepAliveTimeout = 5_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, options.host ?? "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (err) => log.error({ err }, "erro no servidor de saude"));

  const boundPort = (server.address() as AddressInfo).port;
  log.info({ port: boundPort }, "servidor de saude ouvindo");

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
