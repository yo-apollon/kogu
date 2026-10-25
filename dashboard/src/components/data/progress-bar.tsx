import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Texto acessivel. */
  label: string;
  /** Cor CSS da barra; padrao: acento. */
  color?: string;
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({ value, max = 100, label, color = "var(--accent)", showValue = false, className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={Math.min(safeMax, Math.max(0, value))}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
      {showValue ? <span className="num w-10 text-right text-xs text-muted">{Math.round(pct)}%</span> : null}
    </div>
  );
}
