import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { normalizeVariant } from "./constants";

export function VariantBadge({ variant, className }: { variant?: string | null; className?: string }) {
  const t = useTranslations("variant");
  const key = normalizeVariant(variant);
  return (
    <Badge color={`var(--variant-${key})`} className={className}>
      {t(key)}
    </Badge>
  );
}
