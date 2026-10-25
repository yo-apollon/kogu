import { useId } from "react";
import { cn } from "@/lib/cn";

export interface SparklineProps {
  data: readonly number[];
  /** Texto acessivel (vira <title> e aria-label). */
  label: string;
  width?: number;
  height?: number;
  /** Cor CSS do traco; padrao: cor de acento. */
  color?: string;
  className?: string;
}

/** Linha minima em SVG proprio, sem eixos. */
export function Sparkline({ data, label, width = 96, height = 28, color = "var(--accent)", className }: SparklineProps) {
  const titleId = useId();
  const pad = 2;
  if (data.length === 0) {
    return (
      <svg role="img" aria-labelledby={titleId} width={width} height={height} className={className}>
        <title id={titleId}>{label}</title>
      </svg>
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <title id={titleId}>{label}</title>
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={2} fill={color} /> : null}
    </svg>
  );
}
