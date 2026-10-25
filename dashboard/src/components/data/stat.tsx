import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Par rotulo/valor compacto, em linha ou empilhado. */
export function Stat({
  label,
  value,
  stacked = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(stacked ? "grid gap-0.5" : "flex items-baseline justify-between gap-3", className)}>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="num text-base font-medium">{value}</dd>
    </div>
  );
}
