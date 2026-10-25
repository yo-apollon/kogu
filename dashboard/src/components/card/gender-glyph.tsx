import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { normalizeGender, type Gender } from "./constants";

const GLYPHS: Record<Gender, string> = {
  female: "♀",
  male: "♂",
  both: "⚥",
  nonbinary: "⚧",
  unknown: "?",
  item: "◆",
};

export function GenderGlyph({ gender, className }: { gender?: string | null; className?: string }) {
  const t = useTranslations("gender");
  const key = normalizeGender(gender);
  return (
    <span role="img" aria-label={t(key)} title={t(key)} className={cn("inline-block w-4 text-center text-muted", className)}>
      {GLYPHS[key]}
    </span>
  );
}
