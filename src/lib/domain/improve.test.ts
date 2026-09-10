import { describe, expect, it } from "vitest";
import { failureLabel, suggestThresholds, type SaleOutcome } from "./improve";
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

const sale = (profit: number, holdingDays = 20, code?: string): SaleOutcome => ({
  realizedProfit: profit,
  holdingDays,
  failureReasonCode: code ?? null,
});

const run = (sales: SaleOutcome[]) => suggestThresholds({ sales, thresholds });

describe("suggestThresholds", () => {
  it("実績が少ないうちは提案しない", () => {
    const r = run([sale(1000), sale(-500)]);
    expect(r.enough).toBe(false);
    expect(r.suggestions).toHaveLength(0);
  });

  it("勝率が半分を下回ったら利益の下限を上げる提案をする", () => {
    const sales = [
      ...Array.from({ length: 7 }, () => sale(-300, 20, "price_drop")),
      ...Array.from({ length: 5 }, () => sale(800)),
    ];
    const r = run(sales);
    expect(r.enough).toBe(true);
    expect(r.winRate).toBeCloseTo(5 / 12, 5);

    const s = r.suggestions.find((x) => x.key === "minNetProfit");
    expect(s?.direction).toBe("tighten");
    expect(s?.suggested).toBe(600);
  });

  it("勝率が高く回転も速ければ、下限を下げて機会を増やす提案をする", () => {
    const sales = Array.from({ length: 12 }, (_, i) => sale(i < 10 ? 900 : -200, 10));
    const r = run(sales);
    const s = r.suggestions.find((x) => x.key === "minNetProfit");
    expect(s?.direction).toBe("relax");
    expect(s?.suggested).toBe(450);
  });

  it("実際の保有日数が上限を超えていたら、上限を実態に寄せる", () => {
    const sales = Array.from({ length: 12 }, () => sale(600, 60));
    const r = run(sales);
    const s = r.suggestions.find((x) => x.key === "maxExpectedDays");
    expect(s?.suggested).toBe(60);
  });

  it("相場下落・競合増加で負けていたら損切りを浅くする", () => {
    const sales = [
      ...Array.from({ length: 6 }, () => sale(-400, 30, "price_drop")),
      ...Array.from({ length: 6 }, () => sale(700, 20)),
    ];
    const r = run(sales);
    const s = r.suggestions.find((x) => x.key === "stopLossRate");
    expect(s?.direction).toBe("tighten");
    expect(s?.suggested).toBe(-0.07);
  });

  it("手数料の見積り違いが続いたら利益率の下限を上げる", () => {
    const sales = [
      ...Array.from({ length: 3 }, () => sale(-200, 20, "fee_miss")),
      ...Array.from({ length: 9 }, () => sale(700, 20)),
    ];
    const r = run(sales);
    const s = r.suggestions.find((x) => x.key === "minRoi");
    expect(s?.suggested).toBeCloseTo(0.12, 5);
  });

  it("損の原因を多い順に数える", () => {
    const sales = [
      ...Array.from({ length: 12 }, () => sale(500)),
      sale(-100, 20, "competition"),
      sale(-100, 20, "price_drop"),
      sale(-100, 20, "price_drop"),
    ];
    const r = run(sales);
    expect(r.failureBreakdown[0]).toEqual({ code: "price_drop", count: 2 });
  });
});

describe("failureLabel", () => {
  it("原因コードを日本語にする", () => {
    expect(failureLabel("price_drop")).toBe("相場が下がった");
    expect(failureLabel("unknown_code")).toBe("unknown_code");
  });
});
