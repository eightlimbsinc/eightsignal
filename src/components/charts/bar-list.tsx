"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Single-series horizontal bar chart (magnitude by category). One hue, no legend
 * (the card title names the series), recessive hairline grid, hover tooltip,
 * plus a visually-hidden table for screen readers.
 */
export function BarList({ data, title, height }: { data: BarDatum[]; title: string; height?: number }) {
  const h = height ?? Math.max(120, data.length * 30 + 30);
  if (!data.length) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  return (
    <figure>
      <div style={{ height: h }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke="#1f2735" strokeWidth={1} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: "#8b95a7", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={130} tick={{ fill: "#c3cad6", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(59,130,246,0.08)" }}
              contentStyle={{ background: "#121722", border: "1px solid #1f2735", borderRadius: 6, fontSize: 12, color: "#e6e9ef" }}
              itemStyle={{ color: "#e6e9ef" }}
              labelStyle={{ color: "#8b95a7" }}
              formatter={(v) => [v as number, "Records"]}
            />
            <Bar dataKey="value" fill="#3b82f6" maxBarSize={18} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{d.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
