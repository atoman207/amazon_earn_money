import { describe, expect, it } from "vitest";
import type { ExitSignal } from "./exit";
import { planResell, type ResellContext } from "./resell";
import type { ThresholdSettings } from "./types";

const thresholds: ThresholdSettings = {
  minNetProfit: 500,
  minRoi: 0.1,
  maxExpectedDays: 45,
  minConfidence: 0.6,
  stopLossRate: -0.1,
  timeStopDays: 60,
  forceSellDays: 90,
  trailingDrop: 0.12,
  storageRatioCap: 0.3,
};

const signal = (rule: ExitSignal["rule"], kind: ExitSignal["kind"], severity = 50): ExitSignal => ({
  rule,
  kind,
  severity,
  message: "",
});

const ctx = (over: Partial<ResellContext> = {}): ResellContext => ({
  acquisitionCost: 6000,
  targetPrice: 9000,
  stopPrice: 5400,
  currentPrice: 8000,
  median90: 9500,
  qty: 4,
  holdingDays: 10,
  signals: [],
  thresholds,
  ...over,
});

describe("planResell", () => {
  it("売り時でなければ目標価格で待つ", () => {
    const plan = planResell(ctx());
    expect(plan.urgency).toBe("hold");
    expect(plan.price).toBe(9000);
    expect(plan.qty).toBe(4);
    expect(plan.reason).toContain("様子を見ます");
  });

  it("損切りに触れたら全数を現在価格で出す", () => {
    const plan = planResell(ctx({ signals: [signal("X-2", "stop_loss", 100)], currentPrice: 5200 }));
    expect(plan.urgency).toBe("now");
    expect(plan.qty).toBe(4);
    expect(plan.price).toBe(5200);
  });

  it("目標到達なら半分を確定して残りを伸ばす", () => {
    const plan = planResell(ctx({ signals: [signal("E-2", "take_profit", 90)], currentPrice: 9200 }));
    expect(plan.urgency).toBe("soon");
    expect(plan.qty).toBe(2);
    expect(plan.price).toBe(9200);
    expect(plan.reason).toContain("残り2個");
  });

  it("1個しか無いときは分割しない", () => {
    const plan = planResell(
      ctx({ qty: 1, signals: [signal("E-2", "take_profit", 90)], currentPrice: 9200 }),
    );
    expect(plan.qty).toBe(1);
  });

  it("トレーリングが出たら全数を早めに出す", () => {
    const plan = planResell(ctx({ signals: [signal("E-3", "take_profit", 70)], currentPrice: 8600 }));
    expect(plan.qty).toBe(4);
    expect(plan.price).toBe(8600);
  });

  it("時間損切りの区間では段階的に値下げする", () => {
    const plan = planResell(ctx({ holdingDays: 75, signals: [signal("X-1", "stop_loss", 60)] }));
    expect(plan.stepping).toBe(true);
    expect(plan.price).toBeLessThan(9000);
    expect(plan.price).toBeGreaterThanOrEqual(5400);
  });

  it("成行の期日を過ぎたら下限価格で全数を出す", () => {
    const plan = planResell(ctx({ holdingDays: 95, signals: [signal("X-1", "stop_loss", 95)] }));
    expect(plan.qty).toBe(4);
    expect(plan.price).toBeLessThanOrEqual(5400);
    expect(plan.reason).toContain("現金化");
  });

  it("提案数量が保有数を超えない", () => {
    const plan = planResell(ctx({ qty: 2, signals: [signal("X-2", "stop_loss", 100)] }));
    expect(plan.qty).toBeLessThanOrEqual(2);
  });
});
