import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { normalizeTier } from "./constants";

export function TierBadge({ tier, className }: { tier?: string | null; className?: string }) {
  const t = useTranslations("tier");
  const key = normalizeTier(tier);
  return (
    <Badge color={`var(--tier-${key})`} className={className}>
      {t(key)}
    </Badge>
  );
}
