import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const serverSchema = z.object({
  AUTH_SECRET: z.string().min(16),
  AUTH_DISCORD_ID: z.string().min(1),
  AUTH_DISCORD_SECRET: z.string().min(1),
  /** Confia no header Host (obrigatorio atras de proxy fora da Vercel). */
  AUTH_TRUST_HOST: boolish,
  DATABASE_URL_RO: z.string().url(),
  DATABASE_URL_RW: z.string().url(),
  OWNER_IDS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function fail(error: z.ZodError): never {
  // Lista so os NOMES dos campos: nunca ecoa valores (segredos, URLs de banco).
  const fields = error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`Variaveis de ambiente invalidas: ${fields}`);
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) fail(result.error);
  return result.data;
}

let cached: ServerEnv | undefined;

/** Valida de forma preguicosa (so no primeiro uso), para o build nao exigir segredos. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

// Acessores parciais: cada modulo valida SO o que usa (preguicoso, sem cache para facilitar testes).

const authSchema = serverSchema.pick({
  AUTH_SECRET: true,
  AUTH_DISCORD_ID: true,
  AUTH_DISCORD_SECRET: true,
  AUTH_TRUST_HOST: true,
});

export function authEnv(source: Record<string, string | undefined> = process.env) {
  const result = authSchema.safeParse(source);
  if (!result.success) fail(result.error);
  return result.data;
}

export function roDatabaseUrl(source: Record<string, string | undefined> = process.env): string {
  const result = serverSchema.pick({ DATABASE_URL_RO: true }).safeParse(source);
  if (!result.success) fail(result.error);
  return result.data.DATABASE_URL_RO;
}

export function rwDatabaseUrl(source: Record<string, string | undefined> = process.env): string {
  const result = serverSchema.pick({ DATABASE_URL_RW: true }).safeParse(source);
  if (!result.success) fail(result.error);
  return result.data.DATABASE_URL_RW;
}

export function ownerIds(source: Record<string, string | undefined> = process.env): string[] {
  const result = serverSchema.pick({ OWNER_IDS: true }).safeParse(source);
  if (!result.success) fail(result.error);
  return result.data.OWNER_IDS;
}
