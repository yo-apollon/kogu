import { z } from "zod";

const serverSchema = z.object({
  AUTH_SECRET: z.string().min(16),
  AUTH_DISCORD_ID: z.string().min(1),
  AUTH_DISCORD_SECRET: z.string().min(1),
  DATABASE_URL_RO: z.string().url(),
  DATABASE_URL_RW: z.string().url(),
  OWNER_IDS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variaveis de ambiente invalidas: ${fields}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Valida de forma preguicosa (so no primeiro uso), para o build nao exigir segredos. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}