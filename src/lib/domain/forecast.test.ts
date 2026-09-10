import { describe, expect, it } from "vitest";
import { describeForecast, forecastPrice, monthlyIndex, type PricePoint } from "./forecast";

const DAY = 86_400_000;

/** 起点から1日ずつ、価格が step ずつ動く系列を作る */
const series = (count: number, start: number, step: number, from = Date.UTC(2025, 0, 1)): PricePoint[] =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(from + i * DAY).toISOString().slice(0, 10),
    price: Math.round(start + step * i),
  }));

describe("forecastPrice", () => {
  it("観測が3件に満たなければ何も返さない", () => {
    const r = forecastPrice({ history: series(2, 1000, 0) });
    expect(r.points).toHaveLength(0);
    expect(r.reliable).toBe(false);
    expect(r.lastPrice).toBeNull();
  });

  it("下がり続けている系列は下落と判定する", () => {
    const r = forecastPrice({ history: series(90, 5000, -10), horizonDays: 30 });
    expect(r.slopePerDay).toBeLessThan(0);
    expect(r.direction).toBe("down");
    expect(r.changeRate).not.toBeNull();
    expect(r.changeRate!).toBeLessThan(0);
    expect(r.reliable).toBe(true);
  });

  it("上がり続けている系列は上昇と判定する", () => {
    const r = forecastPrice({ history: series(90, 3000, 12), horizonDays: 30 });
    expect(r.slopePerDay).toBeGreaterThan(0);
    expect(r.direction).toBe("up");
  });

  it("動きが小さければ横ばいとして扱う", () => {
    const r = forecastPrice({ history: series(90, 4000, 0), horizonDays: 30 });
    expect(r.direction).toBe("flat");
  });

  it("予測は必ず 下限 ≦ 中心 ≦ 上限 になる", () => {
    const noisy = series(90, 4000, -5).map((p, i) => ({ ...p, price: p.price + (i % 7) * 40 }));
    const r = forecastPrice({ history: noisy, horizonDays: 20 });
    expect(r.points).toHaveLength(20);
    for (const p of r.points) {
      expect(p.low).toBeLessThanOrEqual(p.expected);
      expect(p.expected).toBeLessThanOrEqual(p.high);
      expect(p.low).toBeGreaterThan(0);
    }
  });

  it("先の日付ほど幅が広がる", () => {
    const noisy = series(90, 4000, -5).map((p, i) => ({ ...p, price: p.price + (i % 5) * 60 }));
    const r = forecastPrice({ history: noisy, horizonDays: 30 });
    const first = r.points[0].high - r.points[0].low;
    const last = r.points[r.points.length - 1].high - r.points[r.points.length - 1].low;
    expect(last).toBeGreaterThan(first);
  });

  it("履歴が短ければ数字は返すが reliable にはしない", () => {
    const r = forecastPrice({ history: series(10, 2000, -3), horizonDays: 10 });
    expect(r.points.length).toBe(10);
    expect(r.reliable).toBe(false);
  });

  it("1年に満たない履歴では季節の癖を使わない", () => {
    const r = forecastPrice({ history: series(120, 3000, 0) });
    expect(r.seasonalityApplied).toBe(false);
  });

  it("欠測（0円や NaN）は捨てる", () => {
    const history = [
      ...series(40, 3000, -5),
      { date: "2025-03-01", price: 0 },
      { date: "2025-03-02", price: Number.NaN },
    ];
    const r = forecastPrice({ history });
    expect(r.sampleCount).toBe(40);
  });
});

describe("monthlyIndex", () => {
  it("件数が3件に満たない月は癖として扱わない", () => {
    const index = monthlyIndex([
      { date: "2025-01-01", price: 1000 },
      { date: "2025-01-02", price: 1000 },
      { date: "2025-02-01", price: 2000 },
      { date: "2025-02-02", price: 2000 },
      { date: "2025-02-03", price: 2000 },
    ]);
    expect(index.has(1)).toBe(false);
    expect(index.has(2)).toBe(true);
  });

  it("全体の中央値を 1.00 とした比を返す", () => {
    const index = monthlyIndex([
      ...Array.from({ length: 3 }, (_, i) => ({ date: `2025-01-0${i + 1}`, price: 1000 })),
      ...Array.from({ length: 3 }, (_, i) => ({ date: `2025-07-0${i + 1}`, price: 2000 })),
    ]);
    // 全体の中央値は 1500
    expect(index.get(1)).toBeCloseTo(1000 / 1500, 5);
    expect(index.get(7)).toBeCloseTo(2000 / 1500, 5);
  });
});

describe("describeForecast", () => {
  it("材料が無ければ、その旨を書く", () => {
    const r = forecastPrice({ history: series(2, 1000, 0) });
    expect(describeForecast(r)).toContain("記録がありません");
  });

  it("材料が足りないときは目安だと断る", () => {
    const r = forecastPrice({ history: series(10, 2000, -20), horizonDays: 10 });
    expect(describeForecast(r, 10)).toContain("目安");
  });
});
