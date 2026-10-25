import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface BadgeProps {
  children: ReactNode;
  /** Cor do ponto de sinal (qualquer cor CSS, geralmente var(--tier-*)). Sem cor: so texto. */
  color?: string;
  className?: string;
  title?: string;
}

/** Selo minimalista: borda fina, ponto colorido e texto neutro (a cor e so sinal). */
export function Badge({ children, color, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2 text-xs font-medium whitespace-nowrap text-fg",
        className,
      )}
    >
      {color ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: color } satisfies CSSProperties}
        />
      ) : null}
      {children}
    </span>
  );
}

export const STATES = ["free", "claimed", "expired", "error", "success", "warn", "info"] as const;
export type UiState = (typeof STATES)[number];

export function StateBadge({ state, className }: { state: UiState; className?: string }) {
  const t = useTranslations("state");
  return (
    <Badge color={`var(--state-${state})`} className={className}>
      {t(state)}
    </Badge>
  );
}
