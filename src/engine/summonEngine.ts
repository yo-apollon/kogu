import { db } from "../database/index.js";
import { entities } from "../database/schema.js";
import { eq, and, sql } from "drizzle-orm";

// Memória recente de invocações por servidor (últimos 30 personagens sorteados não repetem)
const recentGuildRolls = new Map<string, string[]>();

export async function rollEntity(filter: {
  gender?: "FEMALE" | "MALE" | "BOTH";
  universe?: string;
  type?: "CHARACTER" | "WEAPON" | "COMPANION" | "DOMAIN";
  excludeSeries?: string[];
  guildId?: string;
}) {
  const conditions = [];

  if (filter.gender && filter.gender !== "BOTH") {
    conditions.push(eq(entities.gender, filter.gender));
  }

  if (filter.universe) {
    conditions.push(eq(entities.universe, filter.universe));
  }

  if (filter.type) {
    conditions.push(eq(entities.type, filter.type));
  }

  // Busca todas as entidades correspondentes
  let allMatching = await db
    .select()
    .from(entities)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Filtra séries desativadas ($disable)
  if (filter.excludeSeries && filter.excludeSeries.length > 0) {
    const lowerExcluded = filter.excludeSeries.map((s) => s.toLowerCase());
    allMatching = allMatching.filter(
      (e) => !lowerExcluded.some((ex) => e.franchise.toLowerCase().includes(ex))
    );
  }

  if (allMatching.length === 0) {
    const fallback = await db.select().from(entities);
    return fallback[Math.floor(Math.random() * fallback.length)] || null;
  }

  // Mecanismo Anti-Repetição: exclui os últimos 25 personagens sorteados nesta guilda
  const guildKey = filter.guildId || "default";
  const recent = recentGuildRolls.get(guildKey) || [];

  let candidates = allMatching.filter((e) => !recent.includes(e.id));
  if (candidates.length === 0) {
    // Se o pool de candidatos zerou, limpa metade do histórico recente
    candidates = allMatching;
    recentGuildRolls.set(guildKey, []);
  }

  // Sorteio com distribuição uniforme
  const selectedIndex = Math.floor(Math.random() * candidates.length);
  const selected = candidates[selectedIndex];

  // Atualiza histórico recente (mantém até 25)
  const updatedRecent = [...recent, selected.id].slice(-25);
  recentGuildRolls.set(guildKey, updatedRecent);

  return selected;
}

export function rollCardVariant(): "STANDARD" | "FOIL" | "HOLO" | "ASTRAL" {
  const rand = Math.random() * 100;
  if (rand < 3) return "ASTRAL"; // 3% Astral Abissal
  if (rand < 12) return "HOLO";  // 9% Holográfica Dourada
  if (rand < 32) return "FOIL";  // 20% Foil Prateada
  return "STANDARD";
}

export function calculateAetherValue(
  baseAether: number,
  variant: string,
  awakeningKeys: number = 0
): number {
  const safeBase = Number(baseAether) || 150;
  let multiplier = 1;
  if (variant === "FOIL") multiplier = 1.25;
  if (variant === "HOLO") multiplier = 1.75;
  if (variant === "ASTRAL") multiplier = 4.0;

  const keys = Number(awakeningKeys) || 0;
  if (keys >= 2) multiplier += 0.1;
  if (keys >= 4) multiplier += 0.1;
  if (keys >= 5) multiplier += 0.1;
  if (keys >= 7) multiplier += 0.1;
  if (keys >= 8) multiplier += 0.1;
  if (keys >= 9) multiplier += 0.1;
  if (keys >= 11) multiplier += (keys - 10) * 0.05;

  return Math.round(safeBase * multiplier);
}
