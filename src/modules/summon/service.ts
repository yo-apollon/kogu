import { and, eq, lt, or, sql } from "drizzle-orm";
import type { CardVariant } from "../../config/gacha.js";
import { db } from "../../infra/db/client.js";
import { guildMembers, rollLog, type Guild, type RollOffer } from "../../infra/db/schema/index.js";
import { getKV } from "../../infra/redis/client.js";
import { UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import { discordRelative } from "../../lib/time.js";
import { currentWindow, nextWindowStart, usedInWindow } from "../../shared/time.js";
import { dailyKey, ensureMember } from "../economy/service.js";
import { createOffer, incrementAwakening } from "./offers.js";
import type { RollFilter } from "./pool.js";
import { rollEntity, type RolledEntity } from "./rollEngine.js";
import { calculateAetherValue, orbReward, rollVariant, type Rng } from "./variants.js";

const log = childLogger("summon:service");

/** Parte da config da guild que define a janela de rolls. `prefix` so enfeita a mensagem de erro. */
export type RollWindowConfig = Pick<Guild, "baseRolls" | "rollIntervalMin" | "resetOffsetMin"> &
  Partial<Pick<Guild, "prefix">>;

export interface ConsumeOptions {
  /** Nome atual no Discord (cria o usuario se for novo). */
  username?: string;
  /** Epoch ms; injetavel para testes. */
  now?: number;
}

export interface RollConsumption {
  /** "window" = roll da hora; "stacked" = roll empilhado do $daily. */
  source: "window" | "stacked";
  /** Rolls da janela ja usados (incluindo este, quando source = window). */
  used: number;
  limit: number;
  /** Rolls da janela que ainda restam. */
  remaining: number;
  stacked: number;
  window: number;
  /** Epoch ms do proximo reset. */
  nextResetAt: number;
}

// Regra da janela em src/shared/time.ts (reexportada por compatibilidade).
export { usedInWindow };

/**
 * Consome 1 roll em UM UPDATE atomico. Janela nova (rolls_window < atual) reinicia o contador em 1;
 * mesma janela incrementa ate `baseRolls`. Sem linha: tenta `stacked_rolls`; senao UserError
 * `summon.rolls_exhausted` com o instante do proximo reset. Cria o membro (saldo de boas-vindas)
 * se ainda nao existir. Sem cron: a virada da janela e o proprio numero da janela.
 */
export async function consumeRoll(
  guildId: string,
  userId: string,
  cfg: RollWindowConfig,
  opts: ConsumeOptions = {}
): Promise<RollConsumption> {
  const now = opts.now ?? Date.now();
  const window = currentWindow(cfg.rollIntervalMin, cfg.resetOffsetMin, now);
  const nextResetAt = nextWindowStart(cfg.rollIntervalMin, cfg.resetOffsetMin, now);
  const base = cfg.baseRolls;

  const consumeWindow = async () => {
    if (base <= 0) return undefined;
    const [row] = await db
      .update(guildMembers)
      .set({
        rollsUsed: sql`CASE WHEN ${guildMembers.rollsWindow} < ${window} THEN 1 ELSE ${guildMembers.rollsUsed} + 1 END`,
        rollsWindow: window,
      })
      .where(
        and(
          eq(guildMembers.guildId, guildId),
          eq(guildMembers.userId, userId),
          or(lt(guildMembers.rollsWindow, window), lt(guildMembers.rollsUsed, base))
        )
      )
      .returning({ used: guildMembers.rollsUsed, stacked: guildMembers.stackedRolls });
    return row;
  };

  let row = await consumeWindow();
  if (!row) {
    // Sem linha: membro inexistente ou limite atingido. Distingue com uma leitura por PK.
    const [exists] = await db
      .select({ userId: guildMembers.userId })
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .limit(1);
    if (!exists) {
      await ensureMember(db, { guildId, userId, username: opts.username });
      row = await consumeWindow();
    }
  }
  if (row) {
    return {
      source: "window",
      used: row.used,
      limit: base,
      remaining: Math.max(0, base - row.used),
      stacked: row.stacked,
      window,
      nextResetAt,
    };
  }

  const [stacked] = await db
    .update(guildMembers)
    .set({ stackedRolls: sql`${guildMembers.stackedRolls} - 1` })
    .where(
      and(
        eq(guildMembers.guildId, guildId),
        eq(guildMembers.userId, userId),
        sql`${guildMembers.stackedRolls} > 0`
      )
    )
    .returning({ stacked: guildMembers.stackedRolls });
  if (stacked) {
    return {
      source: "stacked",
      used: base,
      limit: base,
      remaining: 0,
      stacked: stacked.stacked,
      window,
      nextResetAt,
    };
  }

  throw new UserError("summon.rolls_exhausted", {
    current: 0,
    max: base,
    prefix: cfg.prefix ?? "$",
    nextWindowStart: nextResetAt,
    when: discordRelative(nextResetAt),
  });
}

/** Devolve o roll consumido quando o sorteio falha depois do consumo. */
export async function refundRoll(
  guildId: string,
  userId: string,
  consumed: Pick<RollConsumption, "source" | "window">
): Promise<void> {
  const where = and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId));
  if (consumed.source === "stacked") {
    await db
      .update(guildMembers)
      .set({ stackedRolls: sql`${guildMembers.stackedRolls} + 1` })
      .where(where);
    return;
  }
  await db
    .update(guildMembers)
    .set({ rollsUsed: sql`GREATEST(${guildMembers.rollsUsed} - 1, 0)` })
    .where(and(where, eq(guildMembers.rollsWindow, consumed.window)));
}

/**
 * Zera as janelas de rolls e pactos de todos os membros da guild. Chame quando
 * `roll_interval_min`, `reset_offset_min` ou `claim_cooldown_minutes` mudarem: os numeros de janela
 * passam a ter outra escala, e um rolls_window antigo maior que o atual travaria o contador.
 */
export async function resetGuildWindows(guildId: string): Promise<void> {
  await db
    .update(guildMembers)
    .set({ rollsWindow: -1, pactWindow: -1 })
    .where(eq(guildMembers.guildId, guildId));
}

// ---------------------------------------------------------------------------
// $tu
// ---------------------------------------------------------------------------

export type TimersGuildConfig = RollWindowConfig &
  Pick<Guild, "claimCooldownMinutes" | "pactsPerWindow">;

export interface Timers {
  rolls: { used: number; limit: number; remaining: number; nextResetAt: number };
  stacked: number;
  pacts: {
    used: number;
    limit: number;
    remaining: number;
    ready: boolean;
    nextResetAt: number;
  };
  balance: number;
  daily: { available: boolean; nextAt: number | null };
}

/** Dados do `$tu`: rolls restantes e reset exato, pactos, empilhados, saldo e $daily. Somente leitura. */
export async function getTimers(
  guildId: string,
  userId: string,
  cfg: TimersGuildConfig,
  now: number = Date.now()
): Promise<Timers> {
  const rollWindow = currentWindow(cfg.rollIntervalMin, cfg.resetOffsetMin, now);
  const pactWindow = currentWindow(cfg.claimCooldownMinutes, cfg.resetOffsetMin, now);

  const [m] = await db
    .select({
      rollsUsed: guildMembers.rollsUsed,
      rollsWindow: guildMembers.rollsWindow,
      stacked: guildMembers.stackedRolls,
      pactsUsed: guildMembers.pactsUsed,
      pactWindow: guildMembers.pactWindow,
      balance: guildMembers.aetherBalance,
    })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);

  const rollsUsed = m ? usedInWindow(m.rollsWindow, m.rollsUsed, rollWindow) : 0;
  const pactsUsed = m ? usedInWindow(m.pactWindow, m.pactsUsed, pactWindow) : 0;

  let daily: Timers["daily"] = { available: true, nextAt: null };
  try {
    const kv = await getKV();
    const ttl = await kv.pttl(dailyKey(guildId, userId));
    if (ttl > 0) daily = { available: false, nextAt: now + ttl };
  } catch (err) {
    log.warn({ err }, "KV indisponivel ao ler o cooldown do daily");
  }

  return {
    rolls: {
      used: rollsUsed,
      limit: cfg.baseRolls,
      remaining: Math.max(0, cfg.baseRolls - rollsUsed),
      nextResetAt: nextWindowStart(cfg.rollIntervalMin, cfg.resetOffsetMin, now),
    },
    stacked: m?.stacked ?? 0,
    pacts: {
      used: pactsUsed,
      limit: cfg.pactsPerWindow,
      remaining: Math.max(0, cfg.pactsPerWindow - pactsUsed),
      ready: pactsUsed < cfg.pactsPerWindow,
      nextResetAt: nextWindowStart(cfg.claimCooldownMinutes, cfg.resetOffsetMin, now),
    },
    balance: m?.balance ?? 0,
    daily,
  };
}

// ---------------------------------------------------------------------------
// Fluxo de invocacao
// ---------------------------------------------------------------------------

export type SummonGuildConfig = TimersGuildConfig &
  Pick<
    Guild,
    | "id"
    | "claimWindowSeconds"
    | "snipeProtectionLevel"
    | "snipeProtectionSeconds"
    | "aetherSnipeProtectionLevel"
    | "aetherSnipeProtectionSeconds"
    | "releaseBoostEnabled"
    | "allowAdult"
  >;

export interface SummonParams {
  guild: SummonGuildConfig;
  userId: string;
  username?: string;
  channelId: string;
  filter?: RollFilter;
  rng?: Rng;
  /** Epoch ms; injetavel para testes. */
  now?: number;
}

export interface SummonResult {
  consumption: RollConsumption;
  entity: RolledEntity;
  /** Se a entidade ja tem pacto, herda a variante dele; senao e sorteada. */
  variant: CardVariant;
  aetherValue: number;
  /** Selos de Despertar do pacto existente (ja contando +1 se o dono rolou o proprio personagem). */
  awakeningKeys: number;
  /** true se o dono rolou o proprio personagem e ganhou +1 Selo. */
  awardedKey: boolean;
  /** Valor do orbe (entidade com dono) ou null. */
  orbAether: number | null;
  offer: RollOffer;
}

/**
 * Fluxo completo de `$w`/`$h`/...: consome roll, sorteia, resolve pacto existente (variante,
 * despertar do proprio dono), calcula Eter, define orbe e protecao, e persiste a oferta.
 * Se o sorteio falhar depois do consumo, o roll e devolvido.
 *
 * Protecao de snipe: nivel > 0 reserva a reivindicacao ao invocador por N segundos. Em entidade
 * livre vale `snipe_protection_*` (pacto); em entidade com dono vale `aether_snipe_protection_*`
 * (orbe). Pacto e orbe sao exclusivos na mesma oferta, entao `protected_until` serve aos dois.
 */
export async function performSummon(params: SummonParams): Promise<SummonResult> {
  const { guild, userId } = params;
  const rng = params.rng ?? Math.random;
  const now = params.now ?? Date.now();

  const consumption = await consumeRoll(guild.id, userId, guild, {
    username: params.username,
    now,
  });

  try {
    const entity = await rollEntity({
      guildId: guild.id,
      userId,
      filter: params.filter,
      rng,
      now,
      releaseBoost: guild.releaseBoostEnabled,
      allowAdult: guild.allowAdult,
    });
    if (!entity) throw new UserError("summon.no_entity");

    const pact = entity.pact;
    const variant: CardVariant = pact ? pact.variant : rollVariant(rng);
    let awakeningKeys = pact?.awakeningKeys ?? 0;
    let awardedKey = false;
    if (pact && pact.userId === userId) {
      const awakened = await incrementAwakening(pact.id);
      if (awakened) {
        awakeningKeys = awakened.awakeningKeys;
        awardedKey = true;
      }
    }

    const aetherValue = calculateAetherValue(entity.baseAether, variant, awakeningKeys);
    const orbAether = pact ? orbReward(aetherValue) : null;

    const protectionLevel = pact ? guild.aetherSnipeProtectionLevel : guild.snipeProtectionLevel;
    const protectionSeconds = pact ? guild.aetherSnipeProtectionSeconds : guild.snipeProtectionSeconds;
    const protectedUntil = protectionLevel > 0 ? now + protectionSeconds * 1000 : null;

    const offer = await createOffer({
      guildId: guild.id,
      channelId: params.channelId,
      entity,
      variant,
      aetherValue,
      rolledBy: userId,
      protectedUntil,
      expiresAt: now + guild.claimWindowSeconds * 1000,
      orbAether,
      username: params.username,
    });

    // Auditoria e anti-repeticao de longo prazo; falha aqui nao derruba a invocacao.
    await db
      .insert(rollLog)
      .values({ guildId: guild.id, userId, entityId: entity.id })
      .catch((err: unknown) => log.warn({ err }, "falha ao gravar roll_log"));

    return { consumption, entity, variant, aetherValue, awakeningKeys, awardedKey, orbAether, offer };
  } catch (err) {
    await refundRoll(guild.id, userId, consumption).catch((e: unknown) =>
      log.warn({ err: e }, "falha ao devolver o roll")
    );
    throw err;
  }
}
