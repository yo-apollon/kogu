import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Database } from "../../infra/db/client.js";
import {
  entities,
  guildMembers,
  guilds,
  pacts,
  users,
} from "../../infra/db/schema/index.js";
import { UserError } from "../../lib/errors.js";
import { discordRelative } from "../../lib/time.js";
import { pactAetherValue, type Rng } from "../summon/variants.js";

/** Transacao do drizzle (tipo do callback de db.transaction). */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Aceita o cliente ou uma transacao: os servicos compoem na mesma transacao quando preciso. */
export type Executor = Database | Tx;

/**
 * Eter inicial de quem entra no servidor. O fluxo antigo divergia: summon.ts criava o perfil com 300
 * e rpgCommands.ts (ensureGuildProfile, "Bonus inicial de boas-vindas") com 500. Fica 500, o valor
 * da camada de economia, que e a dona do perfil. Mora aqui porque config/gacha.ts e somente leitura
 * nesta fase; pode migrar para config sem mudar a API.
 */
export const WELCOME_AETHER = 500;

/** $daily: recompensa de Eter = 350 + floor(rng * 250) (350..599, igual ao original). */
export const DAILY_AETHER_MIN = 350;
export const DAILY_AETHER_SPAN = 250;
/** $daily: rolls empilhados concedidos. */
export const DAILY_STACKED_ROLLS = 5;
/**
 * $daily: intervalo entre resgates. O original nao tinha cooldown (resgate ilimitado); a chave
 * i18n `economy.daily_cooldown` ja preve o aviso. Estado no KV (SET NX PX), sem coluna no schema.
 */
export const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export const dailyKey = (guildId: string, userId: string) => `daily:${guildId}:${userId}`;

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`quantia de Eter invalida: ${amount}`);
  }
}

/** Perfil opcional do Discord (a dashboard exibe o avatar); `undefined` = nao sabe, nao altera. */
export interface UserProfile {
  /** Hash do avatar (`user.avatar`); `null` = sem avatar customizado. */
  avatar?: string | null;
  globalName?: string | null;
}

export async function ensureUser(
  exec: Executor,
  userId: string,
  username?: string,
  profile: UserProfile = {}
): Promise<void> {
  if (username) {
    const extra: { avatar?: string | null; globalName?: string | null } = {};
    if (profile.avatar !== undefined) extra.avatar = profile.avatar;
    if (profile.globalName !== undefined) extra.globalName = profile.globalName;
    const changed = [sql`${users.username} IS DISTINCT FROM ${username}`];
    if ("avatar" in extra) changed.push(sql`${users.avatar} IS DISTINCT FROM ${extra.avatar}`);
    if ("globalName" in extra) {
      changed.push(sql`${users.globalName} IS DISTINCT FROM ${extra.globalName}`);
    }
    await exec
      .insert(users)
      .values({ id: userId, username, ...extra })
      .onConflictDoUpdate({
        target: users.id,
        set: { username, ...extra },
        setWhere: sql.join(changed, sql` OR `),
      });
  } else if (profile.avatar !== undefined || profile.globalName !== undefined) {
    // Sem nome atual: usuario novo entra com o id como nome provisorio; o perfil e atualizado.
    const extra: { avatar?: string | null; globalName?: string | null } = {};
    if (profile.avatar !== undefined) extra.avatar = profile.avatar;
    if (profile.globalName !== undefined) extra.globalName = profile.globalName;
    await exec
      .insert(users)
      .values({ id: userId, username: userId, ...extra })
      .onConflictDoUpdate({ target: users.id, set: extra });
  } else {
    await exec.insert(users).values({ id: userId, username: userId }).onConflictDoNothing();
  }
}

export interface MemberRef {
  guildId: string;
  userId: string;
  /** Nome atual no Discord; sem ele o usuario novo entra com o proprio id como nome provisorio. */
  username?: string;
  /** Avatar e nome de exibicao global, quando disponiveis (opcionais). */
  profile?: UserProfile;
}

/**
 * Garante guild, user e guild_members (saldo inicial WELCOME_AETHER so na criacao).
 * Idempotente e seguro sob concorrencia (ON CONFLICT).
 */
export async function ensureMember(
  exec: Executor,
  ref: MemberRef
): Promise<{ created: boolean }> {
  await exec.insert(guilds).values({ id: ref.guildId }).onConflictDoNothing();
  await ensureUser(exec, ref.userId, ref.username, ref.profile);
  const rows = await exec
    .insert(guildMembers)
    .values({ guildId: ref.guildId, userId: ref.userId, aetherBalance: WELCOME_AETHER })
    .onConflictDoNothing()
    .returning({ userId: guildMembers.userId });
  return { created: rows.length > 0 };
}

export async function getBalance(
  guildId: string,
  userId: string,
  exec: Executor = db
): Promise<number> {
  const [row] = await exec
    .select({ balance: guildMembers.aetherBalance })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);
  return row?.balance ?? 0;
}

export interface BalanceOptions {
  /** Transacao em que operar; omitido = cliente (statement unico, ja atomico). */
  exec?: Executor;
  username?: string;
}

/** Soma `amount` ao saldo e devolve o novo saldo. Cria o membro se ainda nao existir. */
export async function credit(
  guildId: string,
  userId: string,
  amount: number,
  opts: BalanceOptions = {}
): Promise<number> {
  assertAmount(amount);
  const exec = opts.exec ?? db;
  const run = () =>
    exec
      .update(guildMembers)
      .set({ aetherBalance: sql`${guildMembers.aetherBalance} + ${amount}` })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .returning({ balance: guildMembers.aetherBalance });

  let [row] = await run();
  if (!row) {
    await ensureMember(exec, { guildId, userId, username: opts.username });
    [row] = await run();
  }
  return row.balance;
}

/**
 * Subtrai `amount` do saldo em um UPDATE condicional (`aether_balance >= amount`), sem
 * leitura-escrita separada. Saldo insuficiente: UserError `errors.insufficient_aether`.
 */
export async function debit(
  guildId: string,
  userId: string,
  amount: number,
  opts: BalanceOptions = {}
): Promise<number> {
  assertAmount(amount);
  const exec = opts.exec ?? db;
  const [row] = await exec
    .update(guildMembers)
    .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${amount}` })
    .where(
      and(
        eq(guildMembers.guildId, guildId),
        eq(guildMembers.userId, userId),
        gte(guildMembers.aetherBalance, amount)
      )
    )
    .returning({ balance: guildMembers.aetherBalance });
  if (!row) {
    const balance = await getBalance(guildId, userId, exec);
    throw new UserError("errors.insufficient_aether", { cost: amount, balance });
  }
  return row.balance;
}

export interface DailyResult {
  /** Eter recebido. */
  reward: number;
  stackedAdded: number;
  balance: number;
  stackedRolls: number;
  /** Epoch ms do proximo resgate. */
  nextAt: number;
}

export interface DailyOptions {
  username?: string;
  profile?: UserProfile;
  rng?: Rng;
}

/**
 * $daily atomico. Porte de handleDailyCommand: Eter 350..599, +5 rolls empilhados e restauracao
 * dos rolls e da carga de pacto da janela atual (rolls_used = 0, pacts_used = 0).
 * Um unico UPDATE aplica tudo; o cooldown e o SET NX do KV, desfeito se a transacao falhar.
 */
export async function claimDaily(
  guildId: string,
  userId: string,
  opts: DailyOptions = {}
): Promise<DailyResult> {
  const rng = opts.rng ?? Math.random;
  const now = Date.now();
  const cutoff = new Date(now - DAILY_COOLDOWN_MS);

  const reward = DAILY_AETHER_MIN + Math.floor(rng() * DAILY_AETHER_SPAN);
  const row = await db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId, username: opts.username, profile: opts.profile });
    // O cooldown vive no banco (last_daily_at), na mesma condicao do UPDATE: sobrevive a
    // reinicios do bot e dois $daily simultaneos nao passam juntos.
    const [updated] = await tx
      .update(guildMembers)
      .set({
        aetherBalance: sql`${guildMembers.aetherBalance} + ${reward}`,
        stackedRolls: sql`${guildMembers.stackedRolls} + ${DAILY_STACKED_ROLLS}`,
        rollsUsed: 0,
        pactsUsed: 0,
        lastDailyAt: new Date(now),
      })
      .where(
        and(
          eq(guildMembers.guildId, guildId),
          eq(guildMembers.userId, userId),
          or(isNull(guildMembers.lastDailyAt), lte(guildMembers.lastDailyAt, cutoff))
        )
      )
      .returning({ balance: guildMembers.aetherBalance, stacked: guildMembers.stackedRolls });
    return updated;
  });

  if (!row) {
    const [member] = await db
      .select({ lastDailyAt: guildMembers.lastDailyAt })
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .limit(1);
    const last = member?.lastDailyAt?.getTime() ?? now;
    const nextAt = last + DAILY_COOLDOWN_MS;
    throw new UserError("economy.daily_cooldown", { when: discordRelative(nextAt), nextAt });
  }

  return {
    reward,
    stackedAdded: DAILY_STACKED_ROLLS,
    balance: row.balance,
    stackedRolls: row.stacked,
    nextAt: now + DAILY_COOLDOWN_MS,
  };
}

export interface DissolveResult {
  pactId: number;
  entityId: number;
  entityName: string;
  /** Eter devolvido (valor atual do pacto, nunca abaixo do registrado na assinatura). */
  refund: number;
  balance: number;
}

/**
 * Dissolve um pacto do jogador e devolve o valor em Eter, tudo em uma transacao.
 * O DELETE ... RETURNING garante que dois dissolves simultaneos paguem uma vez so.
 * Reembolso = max(valor atual com variante e despertar, aether_at_bind).
 */
export async function dissolvePact(
  guildId: string,
  userId: string,
  pactId: number
): Promise<DissolveResult> {
  return db.transaction(async (tx) => {
    const [pact] = await tx
      .delete(pacts)
      .where(and(eq(pacts.id, pactId), eq(pacts.guildId, guildId), eq(pacts.userId, userId)))
      .returning({
        entityId: pacts.entityId,
        variant: pacts.variant,
        awakeningKeys: pacts.awakeningKeys,
        aetherAtBind: pacts.aetherAtBind,
      });
    if (!pact) throw new UserError("errors.not_in_pantheon", { query: String(pactId) });

    const [entity] = await tx
      .select({ name: entities.name, baseAether: entities.baseAether })
      .from(entities)
      .where(eq(entities.id, pact.entityId))
      .limit(1);

    const refund = pactAetherValue(
      entity?.baseAether ?? 0,
      pact.variant,
      pact.awakeningKeys,
      pact.aetherAtBind
    );
    const balance = await credit(guildId, userId, refund, { exec: tx });
    return {
      pactId,
      entityId: pact.entityId,
      entityName: entity?.name ?? "",
      refund,
      balance,
    };
  });
}
