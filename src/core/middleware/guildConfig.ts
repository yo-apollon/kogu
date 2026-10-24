/**
 * Configuracao do servidor com cache em duas camadas:
 *   cache local (30 s) -> KV `guild:cfg:<id>` (10 min) -> Postgres (cria a linha se nao existir).
 * Invalidacao: `invalidate(id)` limpa local + KV e publica em `guild:config:invalidate`; todas as
 * instancias assinam o canal e limpam suas camadas.
 *
 * Mudancas FEITAS FORA do processo (a dashboard escreve direto no banco) nao passam pelo canal. Para
 * elas, `guilds.config_version` (incrementado em toda escrita de config) e conferido quando o cache
 * local vence (30 s): `SELECT config_version` e a linha so e relida se o numero mudou. Com
 * `kvLayer: false` (KV em memoria, bot local) a camada KV e desligada: ela nao serve entre processos
 * e so atrasaria a propagacao.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "../../config/env.js";
import { getLocale } from "../../i18n/index.js";
import type { Database } from "../../infra/db/client.js";
import { guilds, type Guild } from "../../infra/db/schema/guilds.js";
import { publishEvent, subscribeEvent } from "../../infra/redis/pubsub.js";
import type { KV } from "../../infra/redis/kv.js";
import { childLogger } from "../../lib/logger.js";
import type { GuildConfig } from "../contracts.js";
import type { Middleware } from "../context.js";

const log = childLogger("core:guildConfig");

export const GUILD_CONFIG_LOCAL_TTL_MS = 30_000;
export const GUILD_CONFIG_KV_TTL_MS = 10 * 60_000;
const LOCAL_MAX_ENTRIES = 10_000;

export function guildConfigKey(guildId: string): string {
  return `guild:cfg:${guildId}`;
}

export interface GuildConfigProvider {
  get(guildId: string): Promise<GuildConfig>;
}

export interface GuildConfigService extends GuildConfigProvider {
  /** Limpa local + KV e avisa as demais instancias. Chamar apos alterar a linha em `guilds`. */
  invalidate(guildId: string): Promise<void>;
  /** Assina o canal de invalidacao. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

const guildConfigSchema = z.object({
  /** Versao da linha de `guilds` quando o valor foi lido (ausente em entradas antigas do KV). */
  configVersion: z.number().int().optional(),
  id: z.string(),
  prefix: z.string().min(1),
  locale: z.enum(["pt-BR", "en-US"]),
  baseRolls: z.number(),
  rollIntervalMin: z.number(),
  resetOffsetMin: z.number(),
  claimIntervalMin: z.number(),
  claimWindowSeconds: z.number(),
  snipeProtectionLevel: z.number(),
  snipeProtectionSeconds: z.number(),
  pactLimit: z.number(),
  releaseBoostEnabled: z.boolean(),
  allowAdult: z.boolean(),
});

/** Mapeia as colunas de `guilds` para o `GuildConfig` do contrato. */
export function mapGuildRow(row: Guild): GuildConfig {
  return {
    id: row.id,
    prefix: row.prefix,
    locale: getLocale(row.language),
    baseRolls: row.baseRolls,
    rollIntervalMin: row.rollIntervalMin,
    resetOffsetMin: row.resetOffsetMin,
    claimIntervalMin: row.claimCooldownMinutes,
    claimWindowSeconds: row.claimWindowSeconds,
    snipeProtectionLevel: row.snipeProtectionLevel,
    snipeProtectionSeconds: row.snipeProtectionSeconds,
    pactLimit: row.pactLimit,
    releaseBoostEnabled: row.releaseBoostEnabled,
    allowAdult: row.allowAdult,
  };
}

export interface GuildConfigServiceOptions {
  kv: KV;
  db: Database;
  localTtlMs?: number;
  kvTtlMs?: number;
  /**
   * Usa a camada KV (`guild:cfg:<id>`). Padrao `true`; o bootstrap passa `kv.kind !== "memory"`:
   * um MemoryStore e local ao processo e nao compartilha nada.
   */
  kvLayer?: boolean;
  /** Relogio injetavel (testes). */
  now?: () => number;
}

export function createGuildConfigService(options: GuildConfigServiceOptions): GuildConfigService {
  const { kv, db } = options;
  const localTtl = options.localTtlMs ?? GUILD_CONFIG_LOCAL_TTL_MS;
  const kvTtl = options.kvTtlMs ?? GUILD_CONFIG_KV_TTL_MS;
  const now = options.now ?? Date.now;
  const kvLayer = options.kvLayer ?? true;

  interface LocalEntry {
    value: GuildConfig;
    expiresAt: number;
    /** `guilds.config_version` da leitura; `null` se desconhecida (KV antigo). */
    version: number | null;
  }
  const local = new Map<string, LocalEntry>();
  const inflight = new Map<string, Promise<GuildConfig>>();
  /** Incrementa a cada invalidacao: uma carga iniciada antes dela nao pode popular o cache. */
  const generations = new Map<string, number>();
  let unsubscribe: (() => Promise<void>) | null = null;

  const generation = (id: string) => generations.get(id) ?? 0;

  function putLocal(id: string, value: GuildConfig, version: number | null): void {
    if (local.size >= LOCAL_MAX_ENTRIES && !local.has(id)) {
      const oldest = local.keys().next().value;
      if (oldest !== undefined) local.delete(oldest);
    }
    local.set(id, { value, expiresAt: now() + localTtl, version });
  }

  async function loadFromDb(id: string): Promise<{ config: GuildConfig; version: number }> {
    const select = () => db.select().from(guilds).where(eq(guilds.id, id)).limit(1);
    let [row] = await select();
    if (!row) {
      await db
        .insert(guilds)
        .values({ id, prefix: getEnv().DEFAULT_PREFIX })
        .onConflictDoNothing({ target: guilds.id });
      [row] = await select();
    }
    if (!row) throw new Error(`falha ao criar/ler a linha de guilds para ${id}`);
    return { config: mapGuildRow(row), version: row.configVersion };
  }

  async function readVersion(id: string): Promise<number | null> {
    const [row] = await db
      .select({ version: guilds.configVersion })
      .from(guilds)
      .where(eq(guilds.id, id))
      .limit(1);
    return row?.version ?? null;
  }

  async function load(id: string): Promise<GuildConfig> {
    const gen = generation(id);
    const key = guildConfigKey(id);

    let value: GuildConfig | undefined;
    let version: number | null = null;
    if (kvLayer) {
      try {
        const raw = await kv.get(key);
        if (raw !== null) {
          const parsed = guildConfigSchema.safeParse(JSON.parse(raw));
          if (parsed.success) {
            const { configVersion, ...config } = parsed.data;
            value = config;
            version = configVersion ?? null;
          }
        }
      } catch (err) {
        log.warn({ err, guildId: id }, "falha ao ler config do KV; usando o banco");
      }
    }

    if (!value) {
      const loaded = await loadFromDb(id);
      value = loaded.config;
      version = loaded.version;
      if (kvLayer && generation(id) === gen) {
        try {
          await kv.set(key, JSON.stringify({ ...value, configVersion: version }), { px: kvTtl });
        } catch (err) {
          log.warn({ err, guildId: id }, "falha ao gravar config no KV");
        }
      }
    }
    if (generation(id) === gen) putLocal(id, value, version);
    return value;
  }

  /**
   * Cache local vencido: confere `config_version` no banco. Igual = mantem o valor (KV desligado) ou
   * segue o caminho normal KV -> banco (KV ligado). Diferente = alguem mudou a config fora do
   * processo: descarta a copia do KV e rel� a linha. Banco indisponivel = serve a copia vencida.
   */
  async function revalidate(id: string, stale: LocalEntry): Promise<GuildConfig> {
    const gen = generation(id);
    let current: number | null;
    try {
      current = await readVersion(id);
    } catch (err) {
      log.warn({ err, guildId: id }, "falha ao validar config_version; mantendo a copia local");
      if (generation(id) === gen) putLocal(id, stale.value, stale.version);
      return stale.value;
    }
    const unchanged = current !== null && stale.version !== null && current === stale.version;
    if (unchanged && !kvLayer) {
      if (generation(id) === gen) putLocal(id, stale.value, stale.version);
      return stale.value;
    }
    if (!unchanged && kvLayer) {
      await kv.del(guildConfigKey(id)).catch(() => undefined);
    }
    return load(id);
  }

  function dropLocal(id: string): void {
    generations.set(id, generation(id) + 1);
    local.delete(id);
    inflight.delete(id);
  }

  return {
    async get(guildId) {
      const hit = local.get(guildId);
      if (hit && hit.expiresAt > now()) return hit.value;
      const running = inflight.get(guildId);
      if (running) return running;
      const promise = (hit ? revalidate(guildId, hit) : load(guildId)).finally(() => {
        if (inflight.get(guildId) === promise) inflight.delete(guildId);
      });
      inflight.set(guildId, promise);
      return promise;
    },

    async invalidate(guildId) {
      dropLocal(guildId);
      await kv.del(guildConfigKey(guildId));
      await publishEvent(kv, "guild:config:invalidate", { guildId });
    },

    async start() {
      if (unsubscribe) return;
      unsubscribe = await subscribeEvent(kv, "guild:config:invalidate", async ({ guildId }) => {
        dropLocal(guildId);
        await kv.del(guildConfigKey(guildId));
      });
    },

    async stop() {
      const off = unsubscribe;
      unsubscribe = null;
      if (off) await off();
      local.clear();
      inflight.clear();
    },
  };
}

/** Preenche `inv.guildConfig` (o roteador de prefixo ja o preenche para decidir o prefixo). */
export function guildConfigMiddleware(provider: GuildConfigProvider): Middleware {
  return async (inv, next) => {
    inv.guildConfig ??= await provider.get(inv.guild.id);
    await next();
  };
}
