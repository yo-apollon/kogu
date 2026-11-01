import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../infra/db/client.js";
import { entities, entityImages, franchises, guildMembers, pacts, series, entitySeries } from "../../infra/db/schema/index.js";
import { getKV } from "../../infra/redis/client.js";
import { UserError } from "../../lib/errors.js";
import { credit, ensureMember } from "../economy/service.js";

export const TUTO_REWARD_AETHER = 500;
export const TUTO_REWARD_ROLLS = 5;
export const LOOTBOX_COST = 1000;
export const TOWER_BASE_COST = 5000;
export const RT_COOLDOWN_MS = 20 * 60 * 60 * 1000;
export const ARENA_COOLDOWN_MS = 3 * 60 * 1000;
export const ARENA_ENTRY_FEE = 30;
export const ARENA_WIN_REWARD = 250;
export const SLOT_COST = 50;

export const tutoKey = (guildId: string, userId: string) => `tuto:done:${guildId}:${userId}`;
export const towerKey = (guildId: string, userId: string) => `tower:floors:${guildId}:${userId}`;
export const rtKey = (guildId: string, userId: string) => `rt:cd:${guildId}:${userId}`;
export const arenaKey = (guildId: string, userId: string) => `arena:cd:${guildId}:${userId}`;
export const dexKey = (guildId: string, userId: string) => `dex:list:${guildId}:${userId}`;

export interface TowerPerk {
  id: number;
  namePt: string;
  nameEn: string;
  descPt: string;
  descEn: string;
}

export const TOWER_PERKS: readonly TowerPerk[] = [
  { id: 1, namePt: "Santuário de Desejos", nameEn: "Wish Sanctuary", descPt: "+2 slots na Wishlist ($wl)", descEn: "+2 Wishlist slots ($wl)" },
  { id: 2, namePt: "Astro Guia", nameEn: "Guiding Star", descPt: "+50% de chance de spawn para $starwish", descEn: "+50% spawn chance for $starwish" },
  { id: 3, namePt: "Barreira Dimensional", nameEn: "Dimensional Barrier", descPt: "+1 slot na Disablelist ($dl)", descEn: "+1 Disablelist slot ($dl)" },
  { id: 4, namePt: "Ressonância de Selo", nameEn: "Seal Resonance", descPt: "+10% de chance de Selo duplo em desejados", descEn: "+10% double key chance on wished cards" },
  { id: 5, namePt: "Olho de Éter", nameEn: "Aether Eye", descPt: "+15% de Éter em orbes coletados", descEn: "+15% Aether from collected orbs" },
  { id: 6, namePt: "Colheita de Pacto", nameEn: "Pact Harvest", descPt: "+300 Éter de bônus imediato ao construir", descEn: "+300 instant bonus Aether on build" },
  { id: 7, namePt: "Reservatório Astral", nameEn: "Astral Reservoir", descPt: "Capacidade máxima de coleta aumentada em +10%", descEn: "Max orb collection power +10%" },
  { id: 8, namePt: "Eficiência de Coleta", nameEn: "Collection Efficiency", descPt: "Coletar orbes consome -4% de energia", descEn: "Orb buttons cost -4% power" },
  { id: 9, namePt: "Transmutação Dourada", nameEn: "Golden Transmutation", descPt: "Teto de bônus de Selos aumentado em +500 Éter", descEn: "Gold keys max bonus +500 Aether" },
  { id: 10, namePt: "Duplicação Estelar", nameEn: "Star Duplication", descPt: "Orbes de luz concedem +1 orbe extra aleatório", descEn: "Light orbs grant +1 random extra orb" },
  { id: 11, namePt: "Fenda Temporal", nameEn: "Time Rift", descPt: "+3 Rolls empilhados imediatos + bônus horário", descEn: "+3 instant stacked rolls + hourly bonus" },
  { id: 12, namePt: "Soberania Cromática", nameEn: "Chromatic Sovereignty", descPt: "Desbloqueia insígnia soberana do 12º Andar", descEn: "Unlocks 12th Floor Sovereign badge" },
];

/* ------------------------------------------------------------------ */
/* Tutorial ($tuto / $skiptuto) & Freeclaim ($fc) & Reset Timer ($rt) */
/* ------------------------------------------------------------------ */

export interface TutorialClaimResult {
  alreadyClaimed: boolean;
  aetherGranted: number;
  rollsGranted: number;
  freeClaimsAvailable: number;
  balance: number;
}

export async function claimTutorialRewards(
  guildId: string,
  userId: string,
  username?: string
): Promise<TutorialClaimResult> {
  const kv = await getKV();
  const key = tutoKey(guildId, userId);
  const done = await kv.get(key);

  if (done) {
    const [m] = await db
      .select({ balance: guildMembers.aetherBalance, shards: guildMembers.astralShards })
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .limit(1);
    return {
      alreadyClaimed: true,
      aetherGranted: 0,
      rollsGranted: 0,
      freeClaimsAvailable: m?.shards ?? 0,
      balance: m?.balance ?? 0,
    };
  }

  const res = await db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId, username });
    const [updated] = await tx
      .update(guildMembers)
      .set({
        aetherBalance: sql`${guildMembers.aetherBalance} + ${TUTO_REWARD_AETHER}`,
        stackedRolls: sql`${guildMembers.stackedRolls} + ${TUTO_REWARD_ROLLS}`,
        astralShards: sql`${guildMembers.astralShards} + 1`,
      })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .returning({
        balance: guildMembers.aetherBalance,
        shards: guildMembers.astralShards,
      });
    return updated;
  });

  await kv.set(key, "1");

  return {
    alreadyClaimed: false,
    aetherGranted: TUTO_REWARD_AETHER,
    rollsGranted: TUTO_REWARD_ROLLS,
    freeClaimsAvailable: res?.shards ?? 1,
    balance: res?.balance ?? TUTO_REWARD_AETHER,
  };
}

export async function activateFreeClaim(
  guildId: string,
  userId: string,
  username?: string
): Promise<{ remainingCharges: number }> {
  return db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId, username });
    const [updated] = await tx
      .update(guildMembers)
      .set({
        astralShards: sql`${guildMembers.astralShards} - 1`,
        pactsUsed: 0,
      })
      .where(
        and(
          eq(guildMembers.guildId, guildId),
          eq(guildMembers.userId, userId),
          gte(guildMembers.astralShards, 1)
        )
      )
      .returning({ remainingCharges: guildMembers.astralShards });

    if (!updated) {
      throw new UserError("progression.no_freeclaim");
    }
    return updated;
  });
}

export async function activateResetTimer(
  guildId: string,
  userId: string,
  username?: string
): Promise<{ nextReadyInHours: number }> {
  const kv = await getKV();
  const key = rtKey(guildId, userId);
  const existing = await kv.get(key);
  if (existing) {
    throw new UserError("progression.rt_cooldown");
  }

  await db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId, username });
    const [member] = await tx
      .select({ emerald: guildMembers.relicEmerald })
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .limit(1);

    if (!member || member.emerald < 1) {
      throw new UserError("progression.rt_requires_emerald");
    }

    await tx
      .update(guildMembers)
      .set({ pactsUsed: 0 })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));
  });

  await kv.set(key, String(Date.now()), { px: RT_COOLDOWN_MS });
  return { nextReadyInHours: 20 };
}

/* ------------------------------------------------------------------ */
/* Torre de Eter ($ktower / $build / $destroy)                        */
/* ------------------------------------------------------------------ */

export interface TowerState {
  floors: number[];
  level: number;
  nextCost: number;
  totalInvested: number;
  balance: number;
}

export function floorCost(levelIndex: number): number {
  return (levelIndex + 1) * TOWER_BASE_COST;
}

export function totalTowerCost(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += floorCost(i);
  return sum;
}

export async function getTowerState(
  guildId: string,
  userId: string,
  username?: string
): Promise<TowerState> {
  const kv = await getKV();
  const raw = await kv.get(towerKey(guildId, userId));
  let floors: number[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) floors = parsed.filter((n) => typeof n === "number" && n >= 1 && n <= 12);
    } catch {
      floors = [];
    }
  }

  const [m] = await db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId, username });
    return tx
      .select({ balance: guildMembers.aetherBalance })
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .limit(1);
  });

  const level = floors.length;
  return {
    floors,
    level,
    nextCost: floorCost(level),
    totalInvested: totalTowerCost(level),
    balance: m?.balance ?? 0,
  };
}

export async function buildTowerFloor(
  guildId: string,
  userId: string,
  perkId?: number,
  username?: string
): Promise<TowerState & { builtPerk: TowerPerk }> {
  const state = await getTowerState(guildId, userId, username);
  if (state.level >= 12) {
    throw new UserError("progression.tower_max_level");
  }

  const targetPerkId =
    perkId ?? TOWER_PERKS.find((p) => !state.floors.includes(p.id))?.id ?? 1;
  const perk = TOWER_PERKS.find((p) => p.id === targetPerkId);
  if (!perk) {
    throw new UserError("progression.tower_invalid_perk");
  }
  if (state.floors.includes(targetPerkId)) {
    throw new UserError("progression.tower_perk_already_built");
  }

  const cost = state.nextCost;
  const bonusAether = targetPerkId === 6 ? 300 : 0;
  const bonusRolls = targetPerkId === 11 ? 3 : 0;

  const updatedBalance = await db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId, username });
    const [row] = await tx
      .update(guildMembers)
      .set({
        aetherBalance: sql`${guildMembers.aetherBalance} - ${cost} + ${bonusAether}`,
        stackedRolls: sql`${guildMembers.stackedRolls} + ${bonusRolls}`,
      })
      .where(
        and(
          eq(guildMembers.guildId, guildId),
          eq(guildMembers.userId, userId),
          gte(guildMembers.aetherBalance, cost)
        )
      )
      .returning({ balance: guildMembers.aetherBalance });

    if (!row) {
      throw new UserError("progression.insufficient_aether");
    }
    return row.balance;
  });

  const nextFloors = [...state.floors, targetPerkId];
  const kv = await getKV();
  await kv.set(towerKey(guildId, userId), JSON.stringify(nextFloors));

  return {
    floors: nextFloors,
    level: nextFloors.length,
    nextCost: floorCost(nextFloors.length),
    totalInvested: totalTowerCost(nextFloors.length),
    balance: updatedBalance,
    builtPerk: perk,
  };
}

export async function destroyTower(
  guildId: string,
  userId: string,
  username?: string
): Promise<{ refunded: number; balance: number }> {
  const state = await getTowerState(guildId, userId, username);
  if (state.level === 0) {
    throw new UserError("progression.tower_empty");
  }

  const refund = state.totalInvested;
  const balance = await credit(guildId, userId, refund, { username });
  const kv = await getKV();
  await kv.del(towerKey(guildId, userId));

  return { refunded: refund, balance };
}

/* ------------------------------------------------------------------ */
/* Caixas Astrais / Kakera Lootboxes ($kl)                            */
/* ------------------------------------------------------------------ */

export interface LootboxReward {
  kind: "rolls" | "aether" | "key" | "freeclaim";
  amount: number;
  entityName?: string;
  newBalance: number;
}

export async function openLootbox(
  guildId: string,
  userId: string,
  username?: string,
  rng: () => number = Math.random
): Promise<LootboxReward> {
  return db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId, username });

    const [debited] = await tx
      .update(guildMembers)
      .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${LOOTBOX_COST}` })
      .where(
        and(
          eq(guildMembers.guildId, guildId),
          eq(guildMembers.userId, userId),
          gte(guildMembers.aetherBalance, LOOTBOX_COST)
        )
      )
      .returning({ balance: guildMembers.aetherBalance });

    if (!debited) {
      throw new UserError("progression.insufficient_aether");
    }

    const roll = rng();
    if (roll < 0.35) {
      const extraRolls = 3 + Math.floor(rng() * 3); // 3..5 rolls
      await tx
        .update(guildMembers)
        .set({ stackedRolls: sql`${guildMembers.stackedRolls} + ${extraRolls}` })
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));
      return { kind: "rolls", amount: extraRolls, newBalance: debited.balance };
    }

    if (roll < 0.65) {
      const aetherWon = 1200 + Math.floor(rng() * 1100); // 1200..2299
      const [credited] = await tx
        .update(guildMembers)
        .set({ aetherBalance: sql`${guildMembers.aetherBalance} + ${aetherWon}` })
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
        .returning({ balance: guildMembers.aetherBalance });
      return { kind: "aether", amount: aetherWon, newBalance: credited?.balance ?? debited.balance };
    }

    if (roll < 0.85) {
      const [userPact] = await tx
        .select({ id: pacts.id, name: entities.name })
        .from(pacts)
        .innerJoin(entities, eq(entities.id, pacts.entityId))
        .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)))
        .orderBy(desc(pacts.awakeningKeys))
        .limit(1);

      if (userPact) {
        await tx
          .update(pacts)
          .set({ awakeningKeys: sql`${pacts.awakeningKeys} + 1` })
          .where(eq(pacts.id, userPact.id));
        return { kind: "key", amount: 1, entityName: userPact.name, newBalance: debited.balance };
      }

      const fallbackAether = 1400;
      const [credited] = await tx
        .update(guildMembers)
        .set({ aetherBalance: sql`${guildMembers.aetherBalance} + ${fallbackAether}` })
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
        .returning({ balance: guildMembers.aetherBalance });
      return { kind: "aether", amount: fallbackAether, newBalance: credited?.balance ?? debited.balance };
    }

    // 15%: +1 Freeclaim ($fc)
    await tx
      .update(guildMembers)
      .set({ astralShards: sql`${guildMembers.astralShards} + 1` })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));
    return { kind: "freeclaim", amount: 1, newBalance: debited.balance };
  });
}

/* ------------------------------------------------------------------ */
/* Doacao de Eter ($givekakera / $giveether)                          */
/* ------------------------------------------------------------------ */

export async function transferAether(
  guildId: string,
  fromUserId: string,
  toUserId: string,
  amount: number
): Promise<{ senderBalance: number; receiverBalance: number }> {
  if (fromUserId === toUserId) {
    throw new UserError("progression.cannot_give_self");
  }
  if (!Number.isSafeInteger(amount) || amount < 10 || amount > 1_000_000) {
    throw new UserError("progression.invalid_give_amount");
  }

  return db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId: fromUserId });
    await ensureMember(tx, { guildId, userId: toUserId });

    const [sender] = await tx
      .update(guildMembers)
      .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${amount}` })
      .where(
        and(
          eq(guildMembers.guildId, guildId),
          eq(guildMembers.userId, fromUserId),
          gte(guildMembers.aetherBalance, amount)
        )
      )
      .returning({ balance: guildMembers.aetherBalance });

    if (!sender) {
      throw new UserError("progression.insufficient_aether");
    }

    const [receiver] = await tx
      .update(guildMembers)
      .set({ aetherBalance: sql`${guildMembers.aetherBalance} + ${amount}` })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, toUserId)))
      .returning({ balance: guildMembers.aetherBalance });

    return {
      senderBalance: sender.balance,
      receiverBalance: receiver?.balance ?? amount,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Arena RPG ($arena / $duel)                                         */
/* ------------------------------------------------------------------ */

export interface ArenaFighter {
  ownerId: string;
  cardName: string;
  atk: number;
  def: number;
  spd: number;
  hp: number;
  keys: number;
  imageUrl?: string | null;
}

export interface ArenaDuelResult {
  fighterA: ArenaFighter;
  fighterB: ArenaFighter;
  winnerId: string;
  winnerCard: string;
  rounds: number;
  rewardAether: number;
  fee: number;
  netProfit: number;
  log: string[];
  finalHpA: number;
  finalHpB: number;
}

export function renderHpBar(current: number, max: number, size = 10): string {
  const safeMax = Math.max(1, max);
  const ratio = Math.max(0, Math.min(1, current / safeMax));
  const filled = Math.round(ratio * size);
  const empty = size - filled;
  const bar = "▰".repeat(filled) + "▱".repeat(empty);
  return `\`[${bar}]\` **${Math.max(0, current)}/${safeMax} HP**`;
}

async function loadBestFighter(guildId: string, userId: string): Promise<ArenaFighter | null> {
  const [row] = await db
    .select({
      name: entities.name,
      atk: entities.baseAtk,
      def: entities.baseDef,
      spd: entities.baseSpd,
      hp: entities.baseHp,
      keys: pacts.awakeningKeys,
      imageUrl: entityImages.url,
    })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .leftJoin(entityImages, and(eq(entityImages.entityId, entities.id), eq(entityImages.isPrimary, true)))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)))
    .orderBy(desc(pacts.isSoulmate), desc(entities.baseAether), desc(pacts.awakeningKeys))
    .limit(1);

  if (!row) return null;
  const mult = 1 + Math.min(20, row.keys) * 0.05;
  return {
    ownerId: userId,
    cardName: row.name,
    atk: Math.round(row.atk * mult),
    def: Math.round(row.def * mult),
    spd: Math.round(row.spd * mult),
    hp: Math.round(row.hp * mult),
    keys: row.keys,
    imageUrl: row.imageUrl,
  };
}

export async function runArenaBattle(
  guildId: string,
  challengerId: string,
  opponentId?: string
): Promise<ArenaDuelResult> {
  await ensureMember(db, { guildId, userId: challengerId });
  const [challenger] = await db
    .select({ balance: guildMembers.aetherBalance })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, challengerId)))
    .limit(1);

  if ((challenger?.balance ?? 0) < ARENA_ENTRY_FEE) {
    throw new UserError("progression.insufficient_aether");
  }

  // Cobra a taxa de desafio (30 Éter)
  await db
    .update(guildMembers)
    .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${ARENA_ENTRY_FEE}` })
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, challengerId)));

  const fighterA =
    (await loadBestFighter(guildId, challengerId)) ?? {
      ownerId: challengerId,
      cardName: "Espírito Iniciante",
      atk: 55,
      def: 45,
      spd: 50,
      hp: 220,
      keys: 1,
      imageUrl: null,
    };

  const fighterB =
    (opponentId ? await loadBestFighter(guildId, opponentId) : null) ?? {
      ownerId: opponentId ?? "guardian",
      cardName: "Guardião do Obelisco",
      atk: 52,
      def: 42,
      spd: 48,
      hp: 200,
      keys: 1,
      imageUrl: "https://yo-apollon.github.io/kogu/assets/kogu_avatar_animated.gif",
    };

  const maxHpA = fighterA.hp;
  const maxHpB = fighterB.hp;
  let hpA = maxHpA;
  let hpB = maxHpB;
  let rounds = 0;
  const log: string[] = [];

  while (hpA > 0 && hpB > 0 && rounds < 5) {
    rounds++;
    const isCritA = Math.random() < 0.28;
    const isCritB = Math.random() < 0.28;
    const dmgAtoB = Math.max(22, Math.round((fighterA.atk - Math.floor(fighterB.def * 0.35)) * (isCritA ? 1.45 : 1)));
    const dmgBtoA = Math.max(18, Math.round((fighterB.atk - Math.floor(fighterA.def * 0.35)) * (isCritB ? 1.45 : 1)));

    if (fighterA.spd >= fighterB.spd) {
      hpB = Math.max(0, hpB - dmgAtoB);
      log.push(`⚔️ **T${rounds}:** **${fighterA.cardName}** golpeou causando **-${dmgAtoB} HP**${isCritA ? " 💥 *(Crítico!)*" : ""}`);
      if (hpB <= 0) break;
      hpA = Math.max(0, hpA - dmgBtoA);
      log.push(`🛡️ **T${rounds}:** **${fighterB.cardName}** revidou causando **-${dmgBtoA} HP**${isCritB ? " ⚡ *(Crítico!)*" : ""}`);
    } else {
      hpA = Math.max(0, hpA - dmgBtoA);
      log.push(`⚔️ **T${rounds}:** **${fighterB.cardName}** atacou causando **-${dmgBtoA} HP**${isCritB ? " 💥 *(Crítico!)*" : ""}`);
      if (hpA <= 0) break;
      hpB = Math.max(0, hpB - dmgAtoB);
      log.push(`🛡️ **T${rounds}:** **${fighterA.cardName}** contra-atacou causando **-${dmgAtoB} HP**${isCritA ? " ⚡ *(Crítico!)*" : ""}`);
    }
  }

  const aWins = hpA >= hpB;
  const winnerId = aWins ? fighterA.ownerId : fighterB.ownerId;
  const winnerCard = aWins ? fighterA.cardName : fighterB.cardName;

  let rewardAether = 0;
  if (aWins) {
    rewardAether = ARENA_WIN_REWARD;
    await credit(guildId, challengerId, ARENA_WIN_REWARD);
  } else if (opponentId && winnerId === opponentId) {
    await credit(guildId, opponentId, ARENA_WIN_REWARD);
  }

  return {
    fighterA,
    fighterB,
    winnerId,
    winnerCard,
    rounds,
    rewardAether,
    fee: ARENA_ENTRY_FEE,
    netProfit: aWins ? ARENA_WIN_REWARD - ARENA_ENTRY_FEE : -ARENA_ENTRY_FEE,
    log,
    finalHpA: hpA,
    finalHpB: hpB,
  };
}

/* ------------------------------------------------------------------ */
/* Cassino de Familiares / Pokeslot ($slot / $pokemon)                */
/* ------------------------------------------------------------------ */

export interface FamiliarSpecies {
  emoji: string;
  namePt: string;
  nameEn: string;
  rarity: string;
  reward: number;
}

export const FAMILIARS: readonly FamiliarSpecies[] = [
  { emoji: "🍒", namePt: "Poring Astral", nameEn: "Astral Poring", rarity: "★", reward: 150 },
  { emoji: "🦊", namePt: "Kitsune Espiritual", nameEn: "Spirit Kitsune", rarity: "★★", reward: 300 },
  { emoji: "⚡", namePt: "Pikachu Dimensional", nameEn: "Dimensional Pikachu", rarity: "★★★", reward: 500 },
  { emoji: "🐺", namePt: "Sombra de Igris", nameEn: "Shadow Igris", rarity: "★★★★", reward: 900 },
  { emoji: "🐉", namePt: "Dragão Ancestral", nameEn: "Ancient Dragon", rarity: "★★★★★", reward: 2000 },
];

export interface SlotResult {
  reels: [FamiliarSpecies, FamiliarSpecies, FamiliarSpecies];
  won: boolean;
  isJackpot: boolean;
  isShiny: boolean;
  capturedName: string;
  aetherReward: number;
  cost: number;
  netProfit: number;
  newBalance: number;
}

export async function spinSlotMachine(
  guildId: string,
  userId: string,
  username?: string,
  rng: () => number = Math.random
): Promise<SlotResult> {
  await ensureMember(db, { guildId, userId, username });
  const [member] = await db
    .select({ balance: guildMembers.aetherBalance })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);

  const balance = member?.balance ?? 0;
  if (balance < SLOT_COST) {
    throw new UserError("progression.insufficient_aether");
  }

  // Cobra o custo do giro (50 Éter)
  await db
    .update(guildMembers)
    .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${SLOT_COST}` })
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));

  const pick = () => FAMILIARS[Math.floor(rng() * FAMILIARS.length)] ?? FAMILIARS[0];
  const r1 = pick();
  const r2 = rng() < 0.28 ? r1 : pick();
  const r3 = rng() < 0.22 ? r2 : pick();

  const isJackpot = r1.emoji === r2.emoji && r2.emoji === r3.emoji;
  const isPair = !isJackpot && (r1.emoji === r2.emoji || r2.emoji === r3.emoji || r1.emoji === r3.emoji);
  const won = isJackpot || isPair;
  const isShiny = won && rng() < 0.12;

  const matched = r1.emoji === r2.emoji ? r1 : r2.emoji === r3.emoji ? r2 : r1;
  let aetherReward = 0;
  if (isJackpot) {
    aetherReward = Math.round(matched.reward * 2.5 * (isShiny ? 2 : 1));
  } else if (isPair) {
    aetherReward = Math.round(matched.reward * 0.8 * (isShiny ? 1.5 : 1));
  } else {
    aetherReward = 0; // Derrota total: perdeu os 50 Éter!
  }

  let newBalance = balance - SLOT_COST;
  if (aetherReward > 0) {
    newBalance = await credit(guildId, userId, aetherReward, { username });
  }

  if (won) {
    const kv = await getKV();
    const key = dexKey(guildId, userId);
    const raw = await kv.get(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const tag = `${matched.emoji} ${matched.namePt}${isShiny ? " ✨ (SHINY)" : ""}`;
    if (!list.includes(tag)) {
      list.push(tag);
      await kv.set(key, JSON.stringify(list));
    }
  }

  return {
    reels: [r1, r2, r3],
    won,
    isJackpot,
    isShiny,
    capturedName: won ? `${matched.emoji} ${matched.namePt}${isShiny ? " ✨" : ""}` : "",
    aetherReward,
    cost: SLOT_COST,
    netProfit: aetherReward - SLOT_COST,
    newBalance,
  };
}

/* ------------------------------------------------------------------ */
/* Quiz & Blacktea                                                    */
/* ------------------------------------------------------------------ */

export interface QuizQuestion {
  characterName: string;
  imageUrl: string | null;
  correctFranchise: string;
  options: string[];
  correctIndex: number;
}

export async function generateQuizQuestion(): Promise<QuizQuestion> {
  const rows = await db
    .select({
      name: entities.name,
      franchise: sql<string>`coalesce(${series.title}, ${franchises.name}, 'Multiverso')`,
      imageUrl: entityImages.url,
    })
    .from(entities)
    .leftJoin(entityImages, and(eq(entityImages.entityId, entities.id), eq(entityImages.isPrimary, true)))
    .leftJoin(entitySeries, and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true)))
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
    .where(eq(entities.status, "ACTIVE"))
    .orderBy(sql`random()`)
    .limit(12);

  const distinct: Array<{ name: string; franchise: string; imageUrl: string | null }> = [];
  const seenFranchises = new Set<string>();
  for (const r of rows) {
    const f = r.franchise.trim();
    if (f && !seenFranchises.has(f.toLowerCase())) {
      seenFranchises.add(f.toLowerCase());
      distinct.push({ name: r.name, franchise: f, imageUrl: r.imageUrl });
      if (distinct.length === 4) break;
    }
  }

  if (distinct.length < 4) {
    return {
      characterName: "Satoru Gojo",
      imageUrl: null,
      correctFranchise: "Jujutsu Kaisen",
      options: ["Jujutsu Kaisen", "One Piece", "Chainsaw Man", "Solo Leveling"],
      correctIndex: 0,
    };
  }

  const target = distinct[0];
  const options = distinct.map((d) => d.franchise).sort(() => Math.random() - 0.5);
  const correctIndex = options.indexOf(target.franchise);

  return {
    characterName: target.name,
    imageUrl: target.imageUrl,
    correctFranchise: target.franchise,
    options,
    correctIndex: correctIndex >= 0 ? correctIndex : 0,
  };
}

export interface TeaChallenge {
  syllable: string;
  options: string[];
  correctIndex: number;
}

const TEA_ROUNDS: readonly TeaChallenge[] = [
  { syllable: "A R Q", options: ["ARQUITETO", "ARMADURA", "ALQUIMIA", "ASTRAL"], correctIndex: 0 },
  { syllable: "S O L", options: ["ESTelar", "SOLDADO", "SOMBRA", "SAFIRA"], correctIndex: 1 },
  { syllable: "M A R", options: ["MÍSTICO", "MIRAGEM", "MARTELO", "MURALHA"], correctIndex: 2 },
  { syllable: "L U Z", options: ["LENDÁRIO", "LUNAR", "LÂMINA", "RELUZIR"], correctIndex: 3 },
  { syllable: "C O R", options: ["COROAÇÃO", "CRISTAL", "CAÇADOR", "CÓSMICO"], correctIndex: 0 },
  { syllable: "V E N", options: ["VITÓRIA", "VENDAVAL", "VÓRTICE", "VALENTE"], correctIndex: 1 },
];

export function pickTeaChallenge(rng: () => number = Math.random): TeaChallenge {
  return TEA_ROUNDS[Math.floor(rng() * TEA_ROUNDS.length)] ?? TEA_ROUNDS[0];
}

/* ------------------------------------------------------------------ */
/* Minijogos Sociais: Fate, 42ball, Quote                             */
/* ------------------------------------------------------------------ */

export interface AnimeQuote {
  character: string;
  quote: string;
  series: string;
}

export const ANIME_QUOTES: readonly AnimeQuote[] = [
  {
    character: "Kamina",
    series: "Tengen Toppa Gurren Lagann",
    quote: "Não acredite em você. Acredite em mim! Acredite no Kamina que acredita em você!",
  },
  {
    character: "Satoru Gojo",
    series: "Jujutsu Kaisen",
    quote: "Não se preocupe... afinal de contas, eu sou o mais forte.",
  },
  {
    character: "Eren Yeager",
    series: "Attack on Titan",
    quote: "Se você não lutar, você não pode vencer. Lute! Lute!",
  },
  {
    character: "Naruto Uzumaki",
    series: "Naruto",
    quote: "Eu nunca volto atrás na minha palavra... esse é o meu jeito ninja!",
  },
  {
    character: "Lelouch vi Britannia",
    series: "Code Geass",
    quote: "Os únicos que devem atirar são aqueles que estão preparados para levar um tiro.",
  },
  {
    character: "Roronoa Zoro",
    series: "One Piece",
    quote: "Uma cicatriz nas costas é a maior vergonha para um espadachim.",
  },
  {
    character: "Sung Jin-woo",
    series: "Solo Leveling",
    quote: "Erga-se.",
  },
  {
    character: "Levi Ackerman",
    series: "Attack on Titan",
    quote: "A única coisa que nos resta é acreditar que não vamos nos arrepender da escolha que fizemos.",
  },
  {
    character: "Edward Elric",
    series: "Fullmetal Alchemist",
    quote: "Não existe essa coisa de lição sem dor; você não pode ganhar nada sem sacrificar algo em troca.",
  },
  {
    character: "Gilgamesh",
    series: "Fate/stay night",
    quote: "Mestiço! Não ouse levantar os olhos na minha presença sem permissão.",
  },
];

export function getRandomQuote(): AnimeQuote {
  return ANIME_QUOTES[Math.floor(Math.random() * ANIME_QUOTES.length)] ?? ANIME_QUOTES[0]!;
}

export const BALL_42_ANSWERS: readonly string[] = [
  "✨ Os astros confirmam sem sombra de dúvidas: SIM!",
  "🔮 As correntes dimensionais dizem que é uma certeza absoluta.",
  "⭐ Definitivamente sim, o destino já selou este caminho.",
  "✨ Sinais claros apontam para o sucesso.",
  "💫 A resposta é 42 — o sentido de tudo corrobora a sua vitória.",
  "🌙 É provável, mantenha sua determinação.",
  "✨ Uma luz cósmica favorável brilha sobre essa questão.",
  "🔮 O Panteão hesita... pergunte novamente mais tarde.",
  "⏳ As névoas dimensionais estão densas no momento; medite e retorne.",
  "🌀 Melhor não revelar agora, o fluxo temporal está instável.",
  "⚠️ Concentre-se e pergunte outra vez.",
  "⛔ Minhas fontes cósmicas dizem: NÃO.",
  "🌑 As perspectivas são sombrias, desista dessa loucura.",
  "❌ Não conte com isso nem em um milhão de anos-luz.",
  "⚠️ Muito duvidoso. As runas mostram colapso iminente.",
  "🔥 O destino rejeita firmemente essa possibilidade.",
  "🌌 Absolutamente NÃO.",
  "🎲 As probabilidades estão em 1 em 10.000... você tem coragem?",
  "💎 Se você possuir Éter suficiente, tudo é possível.",
  "👑 Só se você casar com uma carta Mítica primeiro!",
];

export function get42BallAnswer(): string {
  return BALL_42_ANSWERS[Math.floor(Math.random() * BALL_42_ANSWERS.length)] ?? BALL_42_ANSWERS[0]!;
}

export async function calculateCosmicFate(
  guildId: string,
  userA: string,
  userB: string
): Promise<{ score: number; verdict: string; cardA?: string; cardB?: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const combined = [userA, userB].sort().join(":") + ":" + today;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0;
  }
  const score = Math.abs(hash) % 101; // 0 a 100

  // Tenta carregar a carta favorita ou de maior Éter de cada um
  const [leadA] = await db
    .select({ name: entities.name })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userA)))
    .orderBy(desc(pacts.isSoulmate), desc(entities.baseAether))
    .limit(1);

  const [leadB] = await db
    .select({ name: entities.name })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userB)))
    .orderBy(desc(pacts.isSoulmate), desc(entities.baseAether))
    .limit(1);

  let verdict = "";
  if (score >= 90) verdict = "💖 Alma Gêmea Cósmica! Alinhamento astral perfeito e harmonia divina!";
  else if (score >= 70) verdict = "✨ Grande Sintonia Dimensional! Vocês formam uma dupla lendária!";
  else if (score >= 50) verdict = "🤝 Bons Companheiros de Batalha! Afinidade moderada e respeito mútuo.";
  else if (score >= 30) verdict = "⚡ Tensão Astral! Pequenas faíscas cósmicas e divergências de gostos.";
  else verdict = "💥 Incompatibilidade Caótica! Distantes como galáxias opostas no vazio!";

  return { score, verdict, cardA: leadA?.name, cardB: leadB?.name };
}

/* ------------------------------------------------------------------ */
/* Disparo Dimensional / Aether Beam ($beam)                          */
/* ------------------------------------------------------------------ */

export interface BeamResult {
  powerWatts: string;
  tierName: string;
  impactStatus: string;
  shardAether: number;
  color: number;
}

export function generateAetherBeam(hasTarget: boolean, targetName?: string): BeamResult {
  const tiers = [
    { name: "Hipernova Dimensional", minGW: 1200, maxGW: 3200, color: 0x06b6d4 },
    { name: "Quasar Cósmico", minGW: 3600, maxGW: 8500, color: 0x8b5cf6 },
    { name: "Singularidade Astral", minGW: 9000, maxGW: 19500, color: 0xec4899 },
    { name: "Colapso do Vazio Ômega", minGW: 22000, maxGW: 75000, color: 0xfacc15 },
  ];
  const tier = tiers[Math.floor(Math.random() * tiers.length)]!;
  const gw = (tier.minGW + Math.floor(Math.random() * (tier.maxGW - tier.minGW))).toLocaleString("pt-BR");

  const targetImpacts = [
    `💥 **Impacto Direto Total!** A guarda de **${targetName}** colapsou diante da torrente cósmica!`,
    `⚡ **Impacto Crítico Devastador!** **${targetName}** tentou usar um teletransporte astral, mas o feixe desintegrou o escudo!`,
    `🛡️ **Resistência Mística!** **${targetName}** defendeu o núcleo do golpe com um artefato épico, espalhando radiação astral nos arredores!`,
  ];

  const voidImpacts = [
    `🌌 **Fenda Gravitacional Aberta!** O tecido da realidade estalou e rachaduras luminescentes surgiram no multiverso!`,
    `✨ **Ressonância Dimensional!** A explosão de partículas astrais iluminou todo o cosmos com pura energia violeta!`,
    `💥 **Detonação de Antimatéria!** Uma micro-supernova detonou na atmosfera dimensional gerando ondas de choque de Éter!`,
  ];

  const impactStatus = hasTarget && targetName
    ? targetImpacts[Math.floor(Math.random() * targetImpacts.length)]!
    : voidImpacts[Math.floor(Math.random() * voidImpacts.length)]!;

  const shardAether = 75 + Math.floor(Math.random() * 126); // 75..200 Éter

  return {
    powerWatts: `${gw} GigaWatts de Éter`,
    tierName: tier.name,
    impactStatus,
    shardAether,
    color: tier.color,
  };
}

/* ------------------------------------------------------------------ */
/* Cassino Dimensional: Blackjack 21 ($bj / $blackjack)               */
/* ------------------------------------------------------------------ */

export interface PlayingCard {
  suit: string;
  rank: string;
  value: number;
}

export interface BlackjackGame {
  sessionId: string;
  guildId: string;
  userId: string;
  username: string;
  bet: number;
  playerCards: PlayingCard[];
  dealerCards: PlayingCard[];
  playerScore: number;
  dealerScore: number;
  gameOver: boolean;
  status: "playing" | "player_blackjack" | "player_bust" | "dealer_bust" | "player_win" | "dealer_win" | "push";
  rewardAether: number;
}

const SUITS = ["♠️", "♥️", "♦️", "♣️"];
const RANKS = [
  { rank: "A", val: 11 },
  { rank: "2", val: 2 },
  { rank: "3", val: 3 },
  { rank: "4", val: 4 },
  { rank: "5", val: 5 },
  { rank: "6", val: 6 },
  { rank: "7", val: 7 },
  { rank: "8", val: 8 },
  { rank: "9", val: 9 },
  { rank: "10", val: 10 },
  { rank: "J", val: 10 },
  { rank: "Q", val: 10 },
  { rank: "K", val: 10 },
];

function drawCard(): PlayingCard {
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)]!;
  const r = RANKS[Math.floor(Math.random() * RANKS.length)]!;
  return { suit, rank: r.rank, value: r.val };
}

export function calcScore(cards: PlayingCard[]): number {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    sum += c.value;
    if (c.rank === "A") aces++;
  }
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces--;
  }
  return sum;
}

export function formatCards(cards: PlayingCard[], hideSecond = false): string {
  if (hideSecond && cards.length >= 2) {
    return `\`[ ${cards[0]!.suit} ${cards[0]!.rank} ]\` \`[ 🎴 ? ]\``;
  }
  return cards.map((c) => `\`[ ${c.suit} ${c.rank} ]\``).join(" ");
}

export async function startBlackjack(
  guildId: string,
  userId: string,
  username: string,
  bet: number
): Promise<BlackjackGame> {
  const kv = await getKV();
  await ensureMember(db, { guildId, userId, username });
  const [member] = await db
    .select({ balance: guildMembers.aetherBalance })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);

  const balance = member?.balance ?? 0;
  if (balance < bet) {
    throw new UserError("progression.insufficient_aether");
  }

  // Debita aposta inicial
  await db
    .update(guildMembers)
    .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${bet}` })
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));

  const pCards = [drawCard(), drawCard()];
  const dCards = [drawCard(), drawCard()];
  const pScore = calcScore(pCards);
  const dScore = calcScore(dCards);

  const sessionId = `${userId}_${Date.now().toString(36)}`;
  let game: BlackjackGame = {
    sessionId,
    guildId,
    userId,
    username,
    bet,
    playerCards: pCards,
    dealerCards: dCards,
    playerScore: pScore,
    dealerScore: dScore,
    gameOver: false,
    status: "playing",
    rewardAether: 0,
  };

  if (pScore === 21) {
    game.gameOver = true;
    if (dScore === 21) {
      game.status = "push";
      game.rewardAether = bet;
      await credit(guildId, userId, bet, { username });
    } else {
      game.status = "player_blackjack";
      const prize = Math.round(bet * 2.5);
      game.rewardAether = prize;
      await credit(guildId, userId, prize, { username });
    }
  }

  if (!game.gameOver) {
    await kv.set(`bj:${sessionId}`, JSON.stringify(game), { px: 180_000 });
  }

  return game;
}

export async function hitBlackjack(sessionId: string): Promise<BlackjackGame> {
  const kv = await getKV();
  const raw = await kv.get(`bj:${sessionId}`);
  if (!raw) throw new UserError("progression.game_expired");
  const game: BlackjackGame = JSON.parse(raw);
  if (game.gameOver) return game;

  game.playerCards.push(drawCard());
  game.playerScore = calcScore(game.playerCards);

  if (game.playerScore > 21) {
    game.gameOver = true;
    game.status = "player_bust";
    game.rewardAether = 0;
    await kv.del(`bj:${sessionId}`);
    return game;
  }

  if (game.playerScore === 21) {
    return standBlackjack(sessionId);
  }

  await kv.set(`bj:${sessionId}`, JSON.stringify(game), { px: 180_000 });
  return game;
}

export async function standBlackjack(sessionId: string): Promise<BlackjackGame> {
  const kv = await getKV();
  const raw = await kv.get(`bj:${sessionId}`);
  if (!raw) throw new UserError("progression.game_expired");
  const game: BlackjackGame = JSON.parse(raw);
  if (game.gameOver) return game;

  game.gameOver = true;
  await kv.del(`bj:${sessionId}`);

  // Dealer joga
  while (calcScore(game.dealerCards) < 17) {
    game.dealerCards.push(drawCard());
  }
  game.dealerScore = calcScore(game.dealerCards);

  if (game.dealerScore > 21) {
    game.status = "dealer_bust";
    game.rewardAether = game.bet * 2;
    await credit(game.guildId, game.userId, game.rewardAether, { username: game.username });
  } else if (game.playerScore > game.dealerScore) {
    game.status = "player_win";
    game.rewardAether = game.bet * 2;
    await credit(game.guildId, game.userId, game.rewardAether, { username: game.username });
  } else if (game.playerScore === game.dealerScore) {
    game.status = "push";
    game.rewardAether = game.bet;
    await credit(game.guildId, game.userId, game.rewardAether, { username: game.username });
  } else {
    game.status = "dealer_win";
    game.rewardAether = 0;
  }

  return game;
}

export async function doubleBlackjack(sessionId: string): Promise<BlackjackGame> {
  const kv = await getKV();
  const raw = await kv.get(`bj:${sessionId}`);
  if (!raw) throw new UserError("progression.game_expired");
  const game: BlackjackGame = JSON.parse(raw);
  if (game.gameOver) return game;

  await ensureMember(db, { guildId: game.guildId, userId: game.userId, username: game.username });
  const [member] = await db
    .select({ balance: guildMembers.aetherBalance })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, game.guildId), eq(guildMembers.userId, game.userId)))
    .limit(1);

  if ((member?.balance ?? 0) < game.bet) {
    throw new UserError("progression.insufficient_aether");
  }

  await db
    .update(guildMembers)
    .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${game.bet}` })
    .where(and(eq(guildMembers.guildId, game.guildId), eq(guildMembers.userId, game.userId)));

  game.bet *= 2;
  game.playerCards.push(drawCard());
  game.playerScore = calcScore(game.playerCards);

  if (game.playerScore > 21) {
    game.gameOver = true;
    game.status = "player_bust";
    game.rewardAether = 0;
    await kv.del(`bj:${sessionId}`);
    return game;
  }

  await kv.set(`bj:${sessionId}`, JSON.stringify(game), { px: 180_000 });
  return standBlackjack(sessionId);
}

/* ------------------------------------------------------------------ */
/* Cara ou Coroa Astral ($coinflip / $cf)                             */
/* ------------------------------------------------------------------ */

export interface CoinflipResult {
  won: boolean;
  choice: "cara" | "coroa";
  flipped: "cara" | "coroa";
  bet: number;
  payout: number;
  newBalance: number;
}

export async function runCoinflip(
  guildId: string,
  userId: string,
  username: string,
  bet: number,
  choice: "cara" | "coroa"
): Promise<CoinflipResult> {
  const [member] = await db
    .select({ balance: guildMembers.aetherBalance })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);

  if ((member?.balance ?? 0) < bet) {
    throw new UserError("progression.insufficient_aether");
  }

  const flipped: "cara" | "coroa" = Math.random() < 0.5 ? "cara" : "coroa";
  const won = choice === flipped;
  const payout = won ? bet * 2 : 0;

  let newBalance = member?.balance ?? 0;
  if (won) {
    newBalance = await credit(guildId, userId, bet, { username });
  } else {
    const [debited] = await db
      .update(guildMembers)
      .set({ aetherBalance: sql`${guildMembers.aetherBalance} - ${bet}` })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .returning({ balance: guildMembers.aetherBalance });
    newBalance = debited?.balance ?? 0;
  }

  return {
    won,
    choice,
    flipped,
    bet,
    payout,
    newBalance,
  };
}
