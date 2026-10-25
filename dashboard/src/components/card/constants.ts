export const TIERS = ["common", "rare", "epic", "legendary", "mythic"] as const;
export type Tier = (typeof TIERS)[number];

export const VARIANTS = ["standard", "foil", "holo", "astral"] as const;
export type Variant = (typeof VARIANTS)[number];

export const GENDERS = ["female", "male", "both", "nonbinary", "unknown", "item"] as const;
export type Gender = (typeof GENDERS)[number];

/** Aceita o enum do banco (COMMON) ou minusculo; valores desconhecidos caem no padrao. */
export function normalizeTier(value: string | null | undefined): Tier {
  const v = value?.toLowerCase();
  return (TIERS as readonly string[]).includes(v ?? "") ? (v as Tier) : "common";
}

export function normalizeVariant(value: string | null | undefined): Variant {
  const v = value?.toLowerCase();
  return (VARIANTS as readonly string[]).includes(v ?? "") ? (v as Variant) : "standard";
}

export function normalizeGender(value: string | null | undefined): Gender {
  const v = value?.toLowerCase();
  return (GENDERS as readonly string[]).includes(v ?? "") ? (v as Gender) : "unknown";
}
