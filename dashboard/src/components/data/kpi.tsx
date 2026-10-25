import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/charts/sparkline";
import { cn } from "@/lib/cn";

export function KpiGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <dl
      className={cn(
        "grid gap-px overflow-hidden rounded-lg border border-border bg-border",
        "grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export interface KpiProps {
  label: string;
  /** Valor ja formatado. */
  value: ReactNode;
  /** Variacao percentual (0.12 = +12%) ja formatada em `deltaText`. */
  delta?: number;
  deltaText?: string;
  hint?: ReactNode;
  spark?: readonly number[];
  sparkLabel?: string;
}

export function Kpi({ label, value, delta, deltaText, hint, spark, sparkLabel }: KpiProps) {
  const t = useTranslations("kpi");
  const dir = delta === undefined ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return (
    <div className="grid min-w-0 content-between gap-3 bg-surface p-3 sm:p-4">
      <dt className="truncate text-xs text-subtle">{label}</dt>
      <dd className="m-0 grid gap-1">
        <div className="flex items-end justify-between gap-2">
          <span className="num truncate text-2xl leading-8 font-semibold tracking-tight">{value}</span>
          {spark && spark.length > 1 ? <Sparkline data={spark} label={sparkLabel ?? label} width={64} height={24} /> : null}
        </div>
        <div className="flex min-h-4 items-center gap-1.5 text-xs">
          {dir ? (
            <span
              className="num inline-flex items-center gap-0.5 font-medium"
              style={{ color: dir === "up" ? "var(--state-success)" : dir === "down" ? "var(--state-error)" : "var(--subtle)" }}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="sr-only">{dir === "flat" ? t("flat") : t(dir, { value: deltaText ?? "" })}</span>
              <span aria-hidden>{deltaText}</span>
            </span>
          ) : null}
          {hint ? <span className="truncate text-subtle">{hint}</span> : null}
        </div>
      </dd>
    </div>
  );
}
