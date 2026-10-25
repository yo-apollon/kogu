import { useId } from "react";
import { cn } from "@/lib/cn";

export interface BarDatum {
  label: string;
  value: number;
}

export interface BarSeriesProps {
  data: readonly BarDatum[];
  /** Texto acessivel do grafico inteiro. */
  label: string;
  height?: number;
  color?: string;
  formatValue?: (value: number) => string;
  className?: string;
}

/** Barras verticais em SVG proprio. Cada barra tem <title> com rotulo e valor. */
export function BarSeries({
  data,
  label,
  height = 96,
  color = "var(--accent)",
  formatValue = (v) => String(v),
  className,
}: BarSeriesProps) {
  const titleId = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const viewW = Math.max(1, data.length) * 10;
  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      viewBox={`0 0 ${viewW} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full overflow-visible", className)}
      style={{ height }}
    >
      <title id={titleId}>{label}</title>
      <line x1={0} x2={viewW} y1={height - 0.5} y2={height - 0.5} stroke="var(--border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 1 : 0, (d.value / max) * (height - 4));
        return (
          <rect key={`${d.label}-${i}`} x={i * 10 + 1.5} y={height - h} width={7} height={h} rx={0.8} fill={color} opacity={0.9}>
            <title>{`${d.label}: ${formatValue(d.value)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
