"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LineAreaChartProps } from "./line-area-chart";

export default function LineAreaChartInner({
  data,
  label,
  height = 220,
  color = "var(--accent)",
  formatValue = (v) => String(v),
}: LineAreaChartProps) {
  return (
    <div role="img" aria-label={label} className="w-full text-[var(--accent)]" style={{ height, color }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--subtle)", fontSize: 12 }} minTickGap={24} />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--subtle)", fontSize: 12 }}
            tickFormatter={(v: number) => formatValue(v)}
          />
          <Tooltip
            formatter={(v) => formatValue(Number(v))}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--fg)",
            }}
          />
          <Area type="monotone" dataKey="value" stroke="currentColor" strokeWidth={1.5} fill="currentColor" fillOpacity={0.08} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
