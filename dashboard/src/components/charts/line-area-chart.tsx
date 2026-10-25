"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export interface LineAreaDatum {
  label: string;
  value: number;
}

export interface LineAreaChartProps {
  data: readonly LineAreaDatum[];
  /** Texto acessivel do grafico. */
  label: string;
  height?: number;
  color?: string;
  formatValue?: (value: number) => string;
}

/** Recharts so e baixado quando o componente aparece (ssr:false). */
const Inner = dynamic(() => import("./line-area-chart.inner"), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

export function LineAreaChart(props: LineAreaChartProps) {
  return <Inner {...props} />;
}
