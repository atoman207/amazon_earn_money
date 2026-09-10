"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ForecastChartPoint {
  date: string;
  /** 実測（過去） */
  actual: number | null;
  /** 予測の中心（未来） */
  expected: number | null;
  /** 予測の幅（下限・幅の大きさ）。積み上げで帯にする */
  band: [number, number] | null;
}

/**
 * 実測と予測を1枚に並べる。
 *
 * 予測は中心の線だけでなく必ず帯（80%の幅）を一緒に描く。
 * 中心線だけを見せると、外れたときに「予測が当たらなかった」ではなく
 * 「予測が間違っていた」と受け取られてしまうため。
 */
export function ForecastChart({ data, height = 280 }: { data: ForecastChartPoint[]; height?: number }) {
  const values = data.flatMap((d) => [d.actual, d.expected, d.band?.[0], d.band?.[1]]);
  const nums = values.filter((v): v is number => typeof v === "number");
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 100;
  const pad = Math.max(50, (max - min) * 0.12);

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e5e5e5" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
            tick={{ fill: "#666666", fontSize: 11 }}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            domain={[Math.max(0, min - pad), max + pad]}
            tickFormatter={(v: number) => Math.round(v).toLocaleString("ja-JP")}
            tick={{ fill: "#666666", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: "#ffffff",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              fontSize: 12,
              color: "#111111",
              padding: "8px 12px",
            }}
            formatter={(value, name) => {
              if (Array.isArray(value)) {
                return [
                  `${Math.round(value[0]).toLocaleString("ja-JP")}〜${Math.round(value[1]).toLocaleString("ja-JP")}円`,
                  String(name ?? ""),
                ];
              }
              return [
                typeof value === "number" ? `${value.toLocaleString("ja-JP")}円` : String(value ?? "—"),
                String(name ?? ""),
              ];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#666666" }} />

          <Area
            type="monotone"
            dataKey="band"
            name="予測の幅（80%）"
            stroke="none"
            fill="#c2410c"
            fillOpacity={0.14}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            name="実測"
            stroke="#1a56db"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="expected"
            name="予測"
            stroke="#c2410c"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
