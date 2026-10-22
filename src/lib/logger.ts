import pino from "pino";
import { getEnv } from "../config/env.js";

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "token",
      "*.token",
      "authorization",
      "*.authorization",
      "*.password",
      "password",
      "headers.authorization",
      "DISCORD_TOKEN",
      "TWITCH_CLIENT_SECRET",
      "TMDB_API_KEY",
    ],
    censor: "[REDACTED]",
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

/** Logger filho com o nome do modulo no contexto. */
export function childLogger(module: string, bindings: Record<string, unknown> = {}) {
  return logger.child({ module, ...bindings });
}
