/**
 * Servico do modulo ADMIN: VIP global, restauracao de rolls para testes e moderacao do Panteao.
 * Sem discord.js nem i18n. Toda escrita roda em `db.transaction`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../infra/db/client.js";
import { guildMembers, pacts, users } from "../../infra/db/schema/index.js";
import { currentWindow } from "../../lib/time.js";
import { ensureMember } from "../economy/service.js";

/** Tiers de `$setvip`: 0 = Normal, 1 = Booster, 2 = VIP Nobre, 3 = Divindade. */
export const MIN_VIP_TIER = 0;
export const MAX_VIP_TIER = 3;

export function isValidVipTier(tier: number): boolean {
  return Number.isInteger(tier) && tier >= MIN_VIP_TIER && tier <= MAX_VIP_TIER;
}

/**
 * Grava o tier VIP (global, nao por servidor) de um usuario, criando a linha se preciso.
 * O chamador garante que quem pediu esta em OWNER_IDS (`ownerOnly` no comando).
 */
export async function setVipTier(
  db: Database,
  target: { id: string; username?: string },
  tier: number
): Promise<{ id: string; tier: number; isVip: boolean }> {
  if (!isValidVipTier(tier)) throw new RangeError(`tier VIP invalido: ${tier}`);
  const isVip = tier > 0;
  return db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: target.id, username: target.username ?? target.id, isVip, vipTier: tier })
      .onConflictDoUpdate({
        target: users.id,
        set: { isVip, vipTier: tier, ...(target.username ? { username: target.username } : {}) },
      });
    return { id: target.id, tier, isVip };
  });
}

/** `$adminreset`: rolls empilhados fixos (como o legado, que gravava 50). */
export const ADMIN_RESET_STACKED_ROLLS = 50;
export const ADMIN_RESET_MAX_ROLLS = 1000;

export interface RestoreRollsInput {
  guildId: string;
  userId: string;
  username?: string;
  baseRolls: number;
  rollIntervalMin: number;
  resetOffsetMin: number;
  /** Intervalo da janela de pactos (guilds.claim_cooldown_minutes). */
  claimIntervalMin: number;
  /** Rolls disponiveis apos o reset; padrao `baseRolls`. O que passar do limite vira empilhado. */
  rolls?: number;
  /** Epoch ms; injetavel para testes. */
  now?: number;
}

export interface RestoreRollsResult {
  /** Rolls disponiveis na janela atual (limite da janela - usados + extras empilhados). */
  rolls: number;
  /** stacked_rolls gravado. */
  stacked: number;
  rollsUsed: number;
}

/**
 * Restaura os rolls do proprio owner: `rolls_used` volta ao necessario para sobrar `rolls`, a janela
 * de rolls e a de pactos ficam na janela atual, `pacts_used = 0` e `stacked_rolls = 50` (+ excedente).
 * Cria o membro (saldo de boas-vindas) se ainda nao existir. Tudo em uma transacao.
 */
export async function restoreRolls(
  db: Database,
  input: RestoreRollsInput
): Promise<RestoreRollsResult> {
  const now = input.now ?? Date.now();
  const rolls = Math.max(0, Math.floor(input.rolls ?? input.baseRolls));
  const rollsUsed = Math.max(0, input.baseRolls - rolls);
  const extra = Math.max(0, rolls - Math.max(0, input.baseRolls));
  const stacked = ADMIN_RESET_STACKED_ROLLS + extra;

  await db.transaction(async (tx) => {
    await ensureMember(tx, {
      guildId: input.guildId,
      userId: input.userId,
      username: input.username,
    });
    await tx
      .update(guildMembers)
      .set({
        rollsUsed,
        rollsWindow: currentWindow(input.rollIntervalMin, input.resetOffsetMin, now),
        pactsUsed: 0,
        pactWindow: currentWindow(input.claimIntervalMin, input.resetOffsetMin, now),
        stackedRolls: stacked,
      })
      .where(and(eq(guildMembers.guildId, input.guildId), eq(guildMembers.userId, input.userId)));
  });
  return { rolls, stacked, rollsUsed };
}

/** Quantos pactos o usuario tem no servidor (para o prompt de confirmacao). */
export async function countUserPacts(db: Database, guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pacts)
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)));
  return row?.n ?? 0;
}

/** `$cleanuser` / `$userdivorce`: libera todos os pactos do usuario no servidor. Devolve quantos. */
export async function releaseUserPacts(db: Database, guildId: string, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(pacts)
      .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)))
      .returning({ id: pacts.id });
    return removed.length;
  });
}

/** Pactos elegiveis ao `$thanos`: os sem Selos de Despertar. */
export async function countThanosCandidates(db: Database, guildId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pacts)
    .where(and(eq(pacts.guildId, guildId), eq(pacts.awakeningKeys, 0)));
  return row?.n ?? 0;
}

const DELETE_CHUNK = 5000;

export interface ThanosResult {
  eligible: number;
  removed: number;
}

/**
 * `$thanos`: dissolve ~50% (sorteio por pacto com `rng`) dos pactos sem Selos do servidor. Os
 * candidatos sao travados (`FOR UPDATE`) e removidos na mesma transacao, entao um `$dissolve`
 * concorrente nao deixa a contagem inconsistente.
 */
export async function snapThanos(
  db: Database,
  guildId: string,
  rng: () => number = Math.random
): Promise<ThanosResult> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: pacts.id })
      .from(pacts)
      .where(and(eq(pacts.guildId, guildId), eq(pacts.awakeningKeys, 0)))
      .for("update");
    const victims = candidates.filter(() => rng() < 0.5).map((c) => c.id);
    for (let i = 0; i < victims.length; i += DELETE_CHUNK) {
      await tx.delete(pacts).where(inArray(pacts.id, victims.slice(i, i + DELETE_CHUNK)));
    }
    return { eligible: candidates.length, removed: victims.length };
  });
}
