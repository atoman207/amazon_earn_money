import { describe, expect, it } from "vitest";
import { screenProduct, type ScreenInput } from "./screen";
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

/** 何の問題も無い商品 */
const healthy: ScreenInput = {
  asin: "B000000001",
  title: "問題のない商品",
  listingGate: "PASS",
  restricted: false,
  salesPerDay: 0.8,
  offerCount: 3,
  volatility: 0.1,
  historyDays: 180,
  sampleCount: 300,
  median90: 5000,
  buyPrice: 3500,
  thresholds,
};

const run = (patch: Partial<ScreenInput> = {}) => screenProduct({ ...healthy, ...patch });
const codes = (patch: Partial<ScreenInput> = {}) => run(patch).checks.map((c) => c.code);

describe("screenProduct", () => {
  it("問題が無ければ ok を返す", () => {
    const r = run();
    expect(r.verdict).toBe("ok");
    expect(r.checks).toHaveLength(0);
  });

  it("出品ゲートが FAIL なら除外する", () => {
    const r = run({ listingGate: "FAIL" });
    expect(r.verdict).toBe("exclude");
    expect(codes({ listingGate: "FAIL" })).toContain("listing_gate");
  });

  it("出品可否が未確認でも除外する（確認できるまで買わせない）", () => {
    const r = run({ listingGate: "UNKNOWN" });
    expect(r.verdict).toBe("exclude");
    expect(r.blocks.map((c) => c.code)).toContain("listing_gate_unknown");
  });

  it("売れた形跡が無ければ除外する", () => {
    const r = run({ salesPerDay: 0 });
    expect(r.verdict).toBe("exclude");
    expect(r.blocks.map((c) => c.code)).toContain("no_sales");
  });

  it("値動きは荒さで警告と除外を分ける", () => {
    expect(run({ volatility: 0.3 }).verdict).toBe("caution");
    expect(run({ volatility: 0.45 }).verdict).toBe("exclude");
  });

  it("競合は多さで警告と除外を分ける", () => {
    expect(run({ offerCount: 16 }).verdict).toBe("caution");
    expect(run({ offerCount: 30 }).verdict).toBe("exclude");
  });

  it("履歴が短ければ注意にとどめる（除外はしない）", () => {
    const r = run({ historyDays: 10, sampleCount: 5 });
    expect(r.verdict).toBe("caution");
    expect(r.warns.map((c) => c.code)).toContain("thin_history");
  });

  it("相場が仕入値を下回っていれば除外する", () => {
    const r = run({ median90: 3000, buyPrice: 3500 });
    expect(r.verdict).toBe("exclude");
    expect(r.blocks.map((c) => c.code)).toContain("market_below_cost");
  });

  it("下落が続く見込みなら除外する", () => {
    expect(run({ forecastChangeRate: -0.12 }).verdict).toBe("exclude");
    expect(run({ forecastChangeRate: -0.05 }).verdict).toBe("ok");
    expect(run({ forecastChangeRate: null }).verdict).toBe("ok");
  });

  it("理由には数字を残す（あとから検証できるようにする）", () => {
    const r = run({ offerCount: 30 });
    expect(r.blocks[0].detail).toContain("30社");
  });
});
