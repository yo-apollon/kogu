import {
  and,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { TIER_MAX_SUPPLY, type CardVariant } from "../../config/gacha.js";
import { db } from "../../infra/db/client.js";
import {
  entities,
  entityLikes,
  guildMembers,
  guilds,
  pacts,
  rollOffers,
  type RollOffer,
} from "../../infra/db/schema/index.js";
import { getKV } from "../../infra/redis/client.js";
import { tryLock, type TryLockResult } from "../../infra/redis/locks.js";
import { UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import { currentWindow, nextWindowStart } from "../../lib/time.js";
import { credit, ensureMember, ensureUser, type Tx } from "../economy/service.js";

const log = childLogger("summon:offers");

/** Lock KV so contra duplo clique; a verdade e o banco (UPDATE condicional + unique de pacts). */
export const PACT_LOCK_TTL_MS = 5000;
export const pactLockKey = (guildId: string, entityId: number) =>
  `lock:pact:${guildId}:${entityId}`;

/**
 * Chaves i18n dos erros. As de summon.* e errors.* ja existem em locales/pt-BR.json, exceto
 * `summon.offer_protected` (params: seconds), que F10/F6 precisam adicionar.
 */
export const OFFER_ERROR = {
  taken: "summon.pact_failed_taken",
  alreadyBound: "summon.pact_already_bound",
  supplyExhausted: "summon.pact_supply_exhausted",
  noCharges: "summon.pact_no_charges",
  expired: "errors.expired",
  protected: "summon.offer_protected",
  orbTaken: "summon.orb_taken",
  entityNotFound: "errors.entity_not_found",
} as const;

/** Codigo SQLSTATE de um erro do driver (direto ou em `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

const toDate = (v: Date | number): Date => (v instanceof Date ? v : new Date(v));

// ---------------------------------------------------------------------------
// Criacao e leitura
// ---------------------------------------------------------------------------

export interface CreateOfferInput {
  guildId: string;
  channelId: string;
  entity: { id: number };
  variant: CardVariant;
  aetherValue: number;
  /** Quem invocou (roll_offers.owner_user_id): unico que reivindica durante a protecao. */
  rolledBy: string;
  /** Ate este instante so `rolledBy` reivindica; null = sem protecao. */
  protectedUntil?: Date | number | null;
  expiresAt: Date | number;
  /** Valor do orbe de Eter (entidade que ja tem dono); null = oferta sem orbe. */
  orbAether?: number | null;
  /** Nome de quem invocou, usado se o usuario ainda nao existir. */
  username?: string;
}

/**
 * Insere a oferta. O id e identity numerico (usado nos customIds `sm:pact|like|orb:<id>`).
 * Se guild/usuario ainda nao existirem (FK), cria e repete uma vez.
 */
export async function createOffer(input: CreateOfferInput): Promise<RollOffer> {
  const values = {
    guildId: input.guildId,
    channelId: input.channelId,
    ownerUserId: input.rolledBy,
    entityId: input.entity.id,
    variant: input.variant,
    aetherValue: input.aetherValue,
    expiresAt: toDate(input.expiresAt),
    protectedUntil: input.protectedUntil == null ? null : toDate(input.protectedUntil),
    orbAether: input.orbAether ?? null,
  };
  try {
    const [offer] = await db.insert(rollOffers).values(values).returning();
    return offer;
  } catch (err) {
    if (pgErrorCode(err) !== "23503") throw err;
    await ensureMember(db, {
      guildId: input.guildId,
      userId: input.rolledBy,
      username: input.username,
    });
    const [offer] = await db.insert(rollOffers).values(values).returning();
    return offer;
  }
}

export async function getOffer(offerId: number): Promise<RollOffer | null> {
  const [offer] = await db
    .select(getTableColumns(rollOffers))
    .from(rollOffers)
    .where(eq(rollOffers.id, offerId))
    .limit(1);
  return offer ?? null;
}

/** Vincula a mensagem do Discord a oferta depois do envio. */
export async function setOfferMessage(offerId: number, messageId: string): Promise<void> {
  await db.update(rollOffers).set({ messageId }).where(eq(rollOffers.id, offerId));
}

// ---------------------------------------------------------------------------
// Reivindicar pacto
// ---------------------------------------------------------------------------

export interface ClaimPactOptions {
  /** Nome atual de quem clica; cria o usuario se for a primeira interacao dele. */
  username?: string;
  /** Epoch ms (janela de pactos). Padrao Date.now(). */
  now?: number;
  /** false pula o lock KV (testes da atomicidade do banco). Padrao true. */
  lock?: boolean;
}

export interface ClaimedPact {
  pactId: number;
  offerId: number;
  guildId: string;
  userId: string;
  entityId: number;
  variant: CardVariant;
  aetherValue: number;
  pactsUsed: number;
  pactsPerWindow: number;
  /** Epoch ms do proximo reset da janela de pactos. */
  nextPactResetAt: number;
}

/** now() do banco; evita depender do relogio do processo para expiracao e protecao. */
const protectionOpen = (userId: string) =>
  or(
    isNull(rollOffers.protectedUntil),
    lt(rollOffers.protectedUntil, sql`now()`),
    eq(rollOffers.ownerUserId, userId)
  );

interface OfferState {
  status: string;
  claimedBy: string | null;
  orbAether: number | null;
  orbClaimedBy: string | null;
  ownerUserId: string;
  expired: boolean;
  protectedMs: number | null;
}

async function loadOfferState(tx: Tx, offerId: number): Promise<OfferState | null> {
  const [s] = await tx
    .select({
      status: rollOffers.status,
      claimedBy: rollOffers.claimedBy,
      orbAether: rollOffers.orbAether,
      orbClaimedBy: rollOffers.orbClaimedBy,
      ownerUserId: rollOffers.ownerUserId,
      expired: sql<boolean>`${rollOffers.expiresAt} <= now()`,
      protectedMs: sql<
        number | null
      >`extract(epoch from (${rollOffers.protectedUntil} - now())) * 1000`.mapWith(Number),
    })
    .from(rollOffers)
    .where(eq(rollOffers.id, offerId))
    .limit(1);
  return s ?? null;
}

function protectedError(state: OfferState, userId: string): UserError | null {
  if (state.ownerUserId !== userId && state.protectedMs !== null && state.protectedMs > 0) {
    return new UserError(OFFER_ERROR.protected, { seconds: Math.ceil(state.protectedMs / 1000) });
  }
  return null;
}

/** Descobre por que o UPDATE condicional nao pegou a oferta e devolve o erro especifico. */
async function explainClaimFailure(tx: Tx, offerId: number, userId: string): Promise<UserError> {
  const s = await loadOfferState(tx, offerId);
  if (!s) return new UserError(OFFER_ERROR.expired);
  if (s.status === "CLAIMED" || s.claimedBy !== null) return new UserError(OFFER_ERROR.taken);
  if (s.status === "EXPIRED" || s.expired) return new UserError(OFFER_ERROR.expired);
  return protectedError(s, userId) ?? new UserError(OFFER_ERROR.taken);
}

async function acquirePactLock(
  guildId: string,
  entityId: number
): Promise<TryLockResult | null> {
  try {
    const kv = await getKV();
    return await tryLock(kv, pactLockKey(guildId, entityId), PACT_LOCK_TTL_MS);
  } catch (err) {
    // Sem KV o banco continua sendo a fonte da verdade; so perdemos o corte de duplo clique.
    log.warn({ err }, "lock de pacto indisponivel; seguindo so com as garantias do banco");
    return null;
  }
}

/**
 * Reivindica o pacto em UMA transacao:
 *  (a) UPDATE condicional da oferta (OPEN, nao reivindicada, nao expirada, fora da protecao ou
 *      dono da invocacao);
 *  (b) consome a janela de pactos do membro (pacts_per_window por claim_cooldown_minutes);
 *  (c) INSERT pacts ON CONFLICT DO NOTHING + claims_count + vinculo oferta/pacto.
 * Qualquer passo vazio faz rollback e lanca UserError especifico. Concorrencia: o row lock do
 * UPDATE (a) serializa os cliques; a unique (guild, entity) de pacts cobre ofertas duplicadas.
 */
export async function claimPact(
  offerId: number,
  userId: string,
  opts: ClaimPactOptions = {}
): Promise<ClaimedPact> {
  const now = opts.now ?? Date.now();

  const [ctx] = await db
    .select({
      guildId: rollOffers.guildId,
      entityId: rollOffers.entityId,
      claimIntervalMin: guilds.claimCooldownMinutes,
      resetOffsetMin: guilds.resetOffsetMin,
      pactsPerWindow: guilds.pactsPerWindow,
    })
    .from(rollOffers)
    .innerJoin(guilds, eq(guilds.id, rollOffers.guildId))
    .where(eq(rollOffers.id, offerId))
    .limit(1);
  if (!ctx) throw new UserError(OFFER_ERROR.expired);

  let lock: TryLockResult | null = null;
  if (opts.lock !== false) {
    lock = await acquirePactLock(ctx.guildId, ctx.entityId);
    if (lock && !lock.acquired) throw new UserError(OFFER_ERROR.taken);
  }

  try {
    return await db.transaction(async (tx) => {
      // (a) reivindica a oferta
      const [offer] = await tx
        .update(rollOffers)
        .set({ status: "CLAIMED", claimedBy: userId, claimedAt: sql`now()` })
        .where(
          and(
            eq(rollOffers.id, offerId),
            eq(rollOffers.status, "OPEN"),
            isNull(rollOffers.claimedBy),
            gt(rollOffers.expiresAt, sql`now()`),
            protectionOpen(userId)
          )
        )
        .returning({
          guildId: rollOffers.guildId,
          entityId: rollOffers.entityId,
          variant: rollOffers.variant,
          aetherValue: rollOffers.aetherValue,
        });
      if (!offer) throw await explainClaimFailure(tx, offerId, userId);

      await ensureMember(tx, { guildId: offer.guildId, userId, username: opts.username });

      // (b) consome a janela de pactos
      const window = currentWindow(ctx.claimIntervalMin, ctx.resetOffsetMin, now);
      const nextPactResetAt = nextWindowStart(ctx.claimIntervalMin, ctx.resetOffsetMin, now);
      const [slot] =
        ctx.pactsPerWindow > 0
          ? await tx
              .update(guildMembers)
              .set({
                pactsUsed: sql`CASE WHEN ${guildMembers.pactWindow} < ${window} THEN 1 ELSE ${guildMembers.pactsUsed} + 1 END`,
                pactWindow: window,
              })
              .where(
                and(
                  eq(guildMembers.guildId, offer.guildId),
                  eq(guildMembers.userId, userId),
                  or(
                    lt(guildMembers.pactWindow, window),
                    lt(guildMembers.pactsUsed, ctx.pactsPerWindow)
                  )
                )
              )
              .returning({ pactsUsed: guildMembers.pactsUsed })
          : [];
      if (!slot) {
        throw new UserError(OFFER_ERROR.noCharges, {
          nextAt: nextPactResetAt,
          max: ctx.pactsPerWindow,
        });
      }

      // (c) verifica limite de tiragem (Opcao A: MYTHIC 1/1, LEGENDARY 3, EPIC 10) e firma o pacto
      const [entTier] = await tx
        .select({ tier: entities.tier })
        .from(entities)
        .where(eq(entities.id, offer.entityId))
        .limit(1);
      const maxSupply = entTier ? TIER_MAX_SUPPLY[entTier.tier] : null;
      if (maxSupply !== null && maxSupply !== undefined) {
        const [supplyRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(pacts)
          .where(eq(pacts.entityId, offer.entityId));
        if ((supplyRow?.count ?? 0) >= maxSupply) {
          throw new UserError(OFFER_ERROR.supplyExhausted, { max: maxSupply });
        }
      }

      const [pact] = await tx
        .insert(pacts)
        .values({
          guildId: offer.guildId,
          userId,
          entityId: offer.entityId,
          variant: offer.variant,
          awakeningKeys: 1,
          aetherAtBind: offer.aetherValue,
        })
        .onConflictDoNothing({ target: [pacts.guildId, pacts.entityId] })
        .returning({ id: pacts.id });
      if (!pact) throw new UserError(OFFER_ERROR.alreadyBound);

      await tx.update(rollOffers).set({ pactId: pact.id }).where(eq(rollOffers.id, offerId));
      await tx
        .update(entities)
        .set({ claimsCount: sql`${entities.claimsCount} + 1` })
        .where(eq(entities.id, offer.entityId));

      return {
        pactId: pact.id,
        offerId,
        guildId: offer.guildId,
        userId,
        entityId: offer.entityId,
        variant: offer.variant,
        aetherValue: offer.aetherValue,
        pactsUsed: slot.pactsUsed,
        pactsPerWindow: ctx.pactsPerWindow,
        nextPactResetAt,
      };
    });
  } finally {
    if (lock?.acquired) await lock.release().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Orbe de Eter
// ---------------------------------------------------------------------------

export interface ClaimedOrb {
  offerId: number;
  guildId: string;
  entityId: number;
  /** Eter creditado (lido do banco, nunca do customId). */
  amount: number;
  balance: number;
}

/**
 * Absorve o orbe: UPDATE condicional em `orb_claimed_by` + credito do saldo na MESMA transacao.
 * Duas absorcoes simultaneas creditam uma vez so.
 */
export async function claimOrb(
  offerId: number,
  userId: string,
  opts: { username?: string } = {}
): Promise<ClaimedOrb> {
  return db.transaction(async (tx) => {
    const [orb] = await tx
      .update(rollOffers)
      .set({ orbClaimedBy: userId, orbClaimedAt: sql`now()` })
      .where(
        and(
          eq(rollOffers.id, offerId),
          isNull(rollOffers.orbClaimedBy),
          isNotNull(rollOffers.orbAether),
          ne(rollOffers.status, "EXPIRED"),
          gt(rollOffers.expiresAt, sql`now()`),
          protectionOpen(userId)
        )
      )
      .returning({
        guildId: rollOffers.guildId,
        entityId: rollOffers.entityId,
        amount: rollOffers.orbAether,
      });

    if (!orb || orb.amount === null) {
      const s = await loadOfferState(tx, offerId);
      if (!s) throw new UserError(OFFER_ERROR.expired);
      if (s.orbClaimedBy !== null || s.orbAether === null) throw new UserError(OFFER_ERROR.orbTaken);
      if (s.status === "EXPIRED" || s.expired) throw new UserError(OFFER_ERROR.expired);
      throw protectedError(s, userId) ?? new UserError(OFFER_ERROR.orbTaken);
    }

    const balance = await credit(orb.guildId, userId, orb.amount, {
      exec: tx,
      username: opts.username,
    });
    return {
      offerId,
      guildId: orb.guildId,
      entityId: orb.entityId,
      amount: orb.amount,
      balance,
    };
  });
}

// ---------------------------------------------------------------------------
// Like, despertar e expiracao
// ---------------------------------------------------------------------------

export interface LikeResult {
  /** true se este clique criou o like; false se o usuario ja tinha curtido. */
  added: boolean;
  likesCount: number;
}

/** Like global: INSERT ON CONFLICT DO NOTHING; likes_count so sobe quando o like foi criado. */
export async function likeEntity(
  userId: string,
  entityId: number,
  opts: { username?: string } = {}
): Promise<LikeResult> {
  try {
    return await db.transaction(async (tx) => {
      await ensureUser(tx, userId, opts.username);
      const inserted = await tx
        .insert(entityLikes)
        .values({ userId, entityId })
        .onConflictDoNothing()
        .returning({ entityId: entityLikes.entityId });

      if (inserted.length > 0) {
        const [row] = await tx
          .update(entities)
          .set({ likesCount: sql`${entities.likesCount} + 1` })
          .where(eq(entities.id, entityId))
          .returning({ likesCount: entities.likesCount });
        return { added: true, likesCount: row.likesCount };
      }
      const [row] = await tx
        .select({ likesCount: entities.likesCount })
        .from(entities)
        .where(eq(entities.id, entityId))
        .limit(1);
      return { added: false, likesCount: row?.likesCount ?? 0 };
    });
  } catch (err) {
    if (pgErrorCode(err) === "23503") {
      throw new UserError(OFFER_ERROR.entityNotFound, { query: String(entityId) });
    }
    throw err;
  }
}

export interface AwakeningResult {
  awakeningKeys: number;
  isSoulmate: boolean;
  entityId: number;
}

/**
 * +1 Selo de Despertar no SQL, atomico (sem read-modify-write): despertares simultaneos somam
 * certo. `is_soulmate` vira true ao atingir 10. Null se o pacto nao existe mais.
 */
export async function incrementAwakening(pactId: number): Promise<AwakeningResult | null> {
  const [row] = await db
    .update(pacts)
    .set({
      awakeningKeys: sql`${pacts.awakeningKeys} + 1`,
      isSoulmate: sql`(${pacts.awakeningKeys} + 1 >= 10)`,
    })
    .where(eq(pacts.id, pactId))
    .returning({
      awakeningKeys: pacts.awakeningKeys,
      isSoulmate: pacts.isSoulmate,
      entityId: pacts.entityId,
    });
  return row ?? null;
}

export interface ExpiredOffer {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  entityId: number;
  ownerUserId: string;
  /** Orbe ja absorvido: o bot nao deve sobrescrever o rotulo "absorvido" do botao. */
  orbAether: number | null;
  orbClaimedBy: string | null;
}

/**
 * Marca como EXPIRED as ofertas OPEN vencidas e as devolve para o bot desabilitar os botoes
 * (sweep de 30 s). Em lotes com FOR UPDATE SKIP LOCKED: varios processos nao disputam as mesmas linhas.
 * Ofertas ja CLAIMED nao entram (a mensagem foi atualizada no clique).
 */
export async function sweepExpiredOffers(
  opts: { batch?: number; maxBatches?: number } = {}
): Promise<ExpiredOffer[]> {
  const batch = opts.batch ?? 200;
  const maxBatches = opts.maxBatches ?? 10;
  const out: ExpiredOffer[] = [];
  for (let i = 0; i < maxBatches; i++) {
    const due = db
      .select({ id: rollOffers.id })
      .from(rollOffers)
      .where(and(eq(rollOffers.status, "OPEN"), lte(rollOffers.expiresAt, sql`now()`)))
      .orderBy(rollOffers.expiresAt)
      .limit(batch)
      .for("update", { skipLocked: true });
    const rows = await db
      .update(rollOffers)
      .set({ status: "EXPIRED" })
      .where(inArray(rollOffers.id, due))
      .returning({
        id: rollOffers.id,
        guildId: rollOffers.guildId,
        channelId: rollOffers.channelId,
        messageId: rollOffers.messageId,
        entityId: rollOffers.entityId,
        ownerUserId: rollOffers.ownerUserId,
        orbAether: rollOffers.orbAether,
        orbClaimedBy: rollOffers.orbClaimedBy,
      });
    out.push(...rows);
    if (rows.length < batch) break;
  }
  return out;
}
