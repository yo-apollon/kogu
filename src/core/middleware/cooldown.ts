/** Cooldown por (usuario, comando) via KV. A mensagem informa o tempo restante. */
import { checkCooldown } from "../../infra/redis/cooldowns.js";
import type { KV } from "../../infra/redis/kv.js";
import { UserError } from "../../lib/errors.js";
import type { Middleware } from "../context.js";

export function cooldownMiddleware(kv: KV): Middleware {
  return async (inv, next) => {
    const ms = inv.command.cooldownMs;
    if (ms && ms > 0) {
      // Valida os argumentos ANTES de gastar o cooldown: uso invalido nao deve punir o usuario.
      inv.buildContext();
      const result = await checkCooldown(kv, inv.user.id, inv.command.name, ms);
      if (!result.ok) {
        throw new UserError("common.cooldown", {
          seconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
        });
      }
    }
    await next();
  };
}
