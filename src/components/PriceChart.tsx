"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface PricePoint {
  date: string;
  sell: number | null;
  buy: number | null;
  offers: number | null;
}

/**
 * 価格の推移グラフ。提案書 4節のご要望どおり、
 * 「仕入れた値段」「目標の値段」「損切りライン」を同じ絵に重ねて、
 * いまどの位置にいるのかを一目で分かるようにする。
 */
export function PriceChart({
  data,
  acquisitionCost,
  targetPrice,
  stopPrice,
  height = 300,
}: {
  data: PricePoint[];
  acquisitionCost?: number | null;
  targetPrice?: number | null;
  stopPrice?: number | null;
  height?: number;
}) {
  const prices = data.flatMap((d) => [d.sell, d.buy]).filter((v): v is number => typeof v === "number");
  const refs = [acquisitionCost, targetPrice, stopPrice].filter(
    (v): v is number => typeof v === "number",
  );
  const all = [...prices, ...refs];
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 100;
  const pad = Math.max(50, (max - min) * 0.12);

  const fmtDate = (d: string) => d.slice(5).replace("-", "/");
  const fmtYen = (v: number) => `${Math.round(v).toLocaleString("ja-JP")}`;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sellFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3355ff" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#3355ff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e7eaf1" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            tick={{ fill: "#6a7689", fontSize: 11 }}
            axisLine={{ stroke: "#e7eaf1" }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            domain={[Math.max(0, min - pad), max + pad]}
            tickFormatter={fmtYen}
            tick={{ fill: "#6a7689", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: "#ffffff",
              border: "1px solid #e7eaf1",
              borderRadius: 12,
              boxShadow: "0 2px 4px rgb(13 21 38 / 0.04), 0 20px 44px -16px rgb(13 21 38 / 0.18)",
              fontSize: 12,
              color: "#0d1526",
              padding: "8px 12px",
            }}
            labelStyle={{ color: "#6a7689" }}
            formatter={(value, name) => [
              typeof value === "number" ? `${value.toLocaleString("ja-JP")}円` : String(value ?? "—"),
              String(name ?? ""),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#6a7689" }} />

          <Area
            type="monotone"
            dataKey="sell"
            name="市場価格"
            stroke="#3355ff"
            strokeWidth={2}
            fill="url(#sellFill)"
            connectNulls
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="buy"
            name="仕入価格"
            stroke="#9aa5b6"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            connectNulls
            dot={false}
          />

          {typeof targetPrice === "number" && (
            <ReferenceLine
              y={targetPrice}
              stroke="#0e9a72"
              strokeDasharray="5 4"
              label={{ value: "目標", fill: "#0e9a72", fontSize: 11, position: "insideTopRight" }}
            />
          )}
          {typeof acquisitionCost === "number" && (
            <ReferenceLine
              y={acquisitionCost}
              stroke="#d97706"
              strokeDasharray="5 4"
              label={{ value: "取得原価", fill: "#d97706", fontSize: 11, position: "insideTopRight" }}
            />
          )}
          {typeof stopPrice === "number" && (
            <ReferenceLine
              y={stopPrice}
              stroke="#d92c43"
              strokeDasharray="5 4"
              label={{ value: "損切り", fill: "#d92c43", fontSize: 11, position: "insideBottomRight" }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
