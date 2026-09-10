import { describe, expect, it } from "vitest";
import { analyzePrecision, type DecisionOutcome } from "./precision";

const outcome = (patch: Partial<DecisionOutcome> = {}): DecisionOutcome => ({
  asin: "B000000001",
  title: "商品",
  judgment: "buy",
  pattern: "timesale",
  confidence: 0.9,
  predictedProfit: 1000,
  predictedDays: 20,
  realizedProfit: 1000,
  realizedDays: 20,
  ...patch,
});

describe("analyzePrecision", () => {
  it("実績が無ければ何も語らない", () => {
    const r = analyzePrecision([]);
    expect(r.count).toBe(0);
    expect(r.hitRate).toBeNull();
    expect(r.enough).toBe(false);
    expect(r.findings).toHaveLength(0);
  });

  it("件数が足りないうちは所見を出さない", () => {
    const r = analyzePrecision([outcome({ realizedProfit: -2000 })]);
    expect(r.enough).toBe(false);
    expect(r.findings).toHaveLength(0);
    // 数字そのものは返す
    expect(r.hitRate).toBe(0);
  });

  it("利益を多く見積もっていれば、その向きを指摘する", () => {
    const rows = Array.from({ length: 6 }, () => outcome({ realizedProfit: 200 }));
    const r = analyzePrecision(rows);
    expect(r.profitBias).toBe(-800);
    expect(r.findings.join()).toContain("少なく");
  });

  it("思ったより時間がかかっていれば、その向きを指摘する", () => {
    const rows = Array.from({ length: 6 }, () => outcome({ realizedDays: 40 }));
    const r = analyzePrecision(rows);
    expect(r.daysBias).toBe(20);
    expect(r.findings.join()).toContain("長く");
  });

  it("信頼度が高いほど勝っていれば、下限を上げる価値があると言う", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => outcome({ confidence: 0.9, realizedProfit: 800 })),
      ...Array.from({ length: 4 }, () => outcome({ confidence: 0.4, realizedProfit: -800 })),
    ];
    const r = analyzePrecision(rows);
    expect(r.findings.join()).toContain("信頼度");
  });

  it("勝率の低い値引きの型を名指しする", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => outcome({ pattern: "demand", realizedProfit: -500 })),
      ...Array.from({ length: 4 }, () => outcome({ pattern: "bottom", realizedProfit: 1000 })),
    ];
    const r = analyzePrecision(rows);
    expect(r.findings.join()).toContain("demand");
  });

  it("判定ラベル・型・信頼度ごとに分けて数える", () => {
    const rows = [
      outcome({ judgment: "buy" }),
      outcome({ judgment: "pilot", realizedProfit: -100 }),
      outcome({ judgment: "pilot", realizedProfit: 300 }),
    ];
    const r = analyzePrecision(rows, 1);
    const pilot = r.byJudgment.find((g) => g.key === "少量検証");
    expect(pilot?.count).toBe(2);
    expect(pilot?.hitRate).toBeCloseTo(0.5, 5);
    expect(r.byPattern[0].key).toBe("timesale");
    expect(r.byConfidence[0].key).toBe("0.85以上（高い）");
  });

  it("誤差率は中央値で見る（外れ値に引きずられないため）", () => {
    const rows = [
      outcome({ predictedProfit: 1000, realizedProfit: 900 }),
      outcome({ predictedProfit: 1000, realizedProfit: 800 }),
      outcome({ predictedProfit: 1000, realizedProfit: 0 }),
    ];
    const r = analyzePrecision(rows, 1);
    expect(r.profitErrorRate).toBeCloseTo(0.2, 5);
  });
});
