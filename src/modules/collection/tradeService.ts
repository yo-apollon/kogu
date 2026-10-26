/**
 * Servico de trocas de pactos (entidades) entre membros do mesmo servidor.
 *
 * Todas as operacoes de troca ocorrem em transacao (`db.transaction`),
 * garantindo atomicidade total: ou ambos os pactos trocam de dono no mesmo
 * instante, ou nada e alterado.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../infra/db/client.js";
import {
  entities,
  entitySeries,
  franchises,
  pacts,
  series,
} from "../../infra/db/schema/index.js";
import { UserError } from "../../lib/errors.js";
import { pactValueSql } from "../../shared/pantheon.js";
import { ensureMember } from "../economy/service.js";

export interface TradePactInfo {
  pactId: number;
  entityId: number;
  name: string;
  series: string | null;
  variant: string;
  value: number;
}

export interface TradePactsPage {
  items: TradePactInfo[];
  page: number;
  totalPages: number;
  total: number;
}

/**
 * Lista as cartas de um jogador para exibicao no menu de selecao da troca.
 * Ordenadas por maior valor de Eter primeiro, depois nome.
 */
export async function getTradePactsPage(
  guildId: string,
  userId: string,
  page: number = 1,
  pageSize: number = 25
): Promise<TradePactsPage> {
  const value = pactValueSql();
  const seriesName = sql<string | null>`coalesce(${series.title}, ${franchises.name})`;
  const where = and(eq(pacts.guildId, guildId), eq(pacts.userId, userId))!;
  const safePage = Math.max(1, Math.floor(page));
  const offset = (safePage - 1) * pageSize;

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        pactId: pacts.id,
        entityId: entities.id,
        name: entities.name,
        series: seriesName,
        variant: pacts.variant,
        value,
      })
      .from(pacts)
      .innerJoin(entities, eq(entities.id, pacts.entityId))
      .leftJoin(
        entitySeries,
        and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
      )
      .leftJoin(series, eq(series.id, entitySeries.seriesId))
      .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
      .where(where)
      .orderBy(desc(value), asc(entities.name), asc(pacts.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(pacts)
      .where(where),
  ]);

  const total = countRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items: rows,
    page: safePage,
    totalPages,
    total,
  };
}

/**
 * Busca os detalhes de um pacto especifico pelo id, confirmando posse.
 */
export async function getPactForTrade(
  guildId: string,
  userId: string,
  pactId: number
): Promise<TradePactInfo | null> {
  const value = pactValueSql();
  const seriesName = sql<string | null>`coalesce(${series.title}, ${franchises.name})`;

  const [row] = await db
    .select({
      pactId: pacts.id,
      entityId: entities.id,
      name: entities.name,
      series: seriesName,
      variant: pacts.variant,
      value,
    })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .leftJoin(
      entitySeries,
      and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
    )
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
    .where(and(eq(pacts.id, pactId), eq(pacts.guildId, guildId), eq(pacts.userId, userId)))
    .limit(1);

  return row ?? null;
}

export interface ExecuteTradeInput {
  guildId: string;
  userA: { id: string; username?: string; pactId: number | null };
  userB: { id: string; username?: string; pactId: number | null };
}

export interface ExecuteTradeResult {
  pactA: TradePactInfo | null;
  pactB: TradePactInfo | null;
}

/**
 * Executa a troca de forma atomica no banco de dados.
 *
 * Pode ser:
 * - 1 para 1: pactA vai para userB e pactB vai para userA.
 * - 1 para 0: pactA vai para userB (doacao consentida).
 * - 0 para 1: pactB vai para userA (doacao consentida).
 */
export async function executeTrade(input: ExecuteTradeInput): Promise<ExecuteTradeResult> {
  const { guildId, userA, userB } = input;

  if (userA.id === userB.id) {
    throw new UserError("collection.trade_self");
  }

  if (userA.pactId === null && userB.pactId === null) {
    throw new UserError("collection.trade_empty");
  }

  return db.transaction(async (tx) => {
    // Garante que ambos os membros existem no banco para as foreign keys de pacts
    await ensureMember(tx, { guildId, userId: userA.id, username: userA.username });
    await ensureMember(tx, { guildId, userId: userB.id, username: userB.username });

    let resultA: TradePactInfo | null = null;
    let resultB: TradePactInfo | null = null;

    // Se userA esta ofertando uma carta, transfere para userB
    if (userA.pactId !== null) {
      const [movedA] = await tx
        .update(pacts)
        .set({
          userId: userB.id,
          sortOrder: 0,
          alias: null,
          alias2: null,
          note: null,
          customImage: null,
          embedColor: null,
        })
        .where(
          and(
            eq(pacts.id, userA.pactId),
            eq(pacts.guildId, guildId),
            eq(pacts.userId, userA.id)
          )
        )
        .returning({ pactId: pacts.id, entityId: pacts.entityId });

      if (!movedA) {
        throw new UserError("collection.trade_pact_lost");
      }

      const [entityA] = await tx
        .select({
          name: entities.name,
          variant: pacts.variant,
          value: pactValueSql(),
        })
        .from(pacts)
        .innerJoin(entities, eq(entities.id, pacts.entityId))
        .where(eq(pacts.id, movedA.pactId));

      if (entityA) {
        resultA = {
          pactId: movedA.pactId,
          entityId: movedA.entityId,
          name: entityA.name,
          series: null,
          variant: entityA.variant,
          value: entityA.value,
        };
      }
    }

    // Se userB esta ofertando uma carta, transfere para userA
    if (userB.pactId !== null) {
      const [movedB] = await tx
        .update(pacts)
        .set({
          userId: userA.id,
          sortOrder: 0,
          alias: null,
          alias2: null,
          note: null,
          customImage: null,
          embedColor: null,
        })
        .where(
          and(
            eq(pacts.id, userB.pactId),
            eq(pacts.guildId, guildId),
            eq(pacts.userId, userB.id)
          )
        )
        .returning({ pactId: pacts.id, entityId: pacts.entityId });

      if (!movedB) {
        throw new UserError("collection.trade_pact_lost");
      }

      const [entityB] = await tx
        .select({
          name: entities.name,
          variant: pacts.variant,
          value: pactValueSql(),
        })
        .from(pacts)
        .innerJoin(entities, eq(entities.id, pacts.entityId))
        .where(eq(pacts.id, movedB.pactId));

      if (entityB) {
        resultB = {
          pactId: movedB.pactId,
          entityId: movedB.entityId,
          name: entityB.name,
          series: null,
          variant: entityB.variant,
          value: entityB.value,
        };
      }
    }

    return { pactA: resultA, pactB: resultB };
  });
}
