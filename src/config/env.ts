import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DISCORD_TOKEN: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DEV_GUILD_ID: optionalString,
  DEFAULT_PREFIX: z.string().min(1).max(5).default("$"),
  OWNER_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),

  DATABASE_URL: optionalString,
  REDIS_URL: optionalString,

  TWITCH_CLIENT_ID: optionalString,
  TWITCH_CLIENT_SECRET: optionalString,
  TMDB_API_KEY: optionalString,

  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Valida e memoriza as variaveis de ambiente. Lanca com mensagem clara se invalidas. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Variaveis de ambiente invalidas: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Variavel obrigatoria para um modulo especifico (ex.: DATABASE_URL no cliente do banco). */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}

export function isOwner(userId: string): boolean {
  return getEnv().OWNER_IDS.includes(userId);
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
