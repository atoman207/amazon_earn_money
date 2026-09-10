import { describe, expect, it } from "vitest";
import { allocate, kellyFraction } from "./allocation";
import { evaluateExit, steppedPrice } from "./exit";
import {
  annualizedReturn,
  calcConfidence,
  calcMaxBuyPrice,
  calcProfit,
  calcRiskFactor,
  calcVelocity,
  evaluate,
  expectedProfit,
} from "./profit";
import type { CostSettings, ThresholdSettings } from "./types";

const costs: CostSettings = {
  inboundCostPerUnit: 150,
  pointsBackRate: 0.005,
  returnsRate: 0.02,
  storageFeePerDay: 8,
  fbaFeeByTier: { small: 290, standard: 434, large: 603, oversize: 1000 },
};

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

describe("calcProfit — 提案書 3.2節の内訳表", () => {
  it("提案書の数値例を再現する（販売10,000 / 仕入7,000 → 純利益1,700前後）", () => {
    // 提案書の例に合わせた係数（手数料10%、配送代行400、保管100、返品200、還元400、入庫0）
    const p = calcProfit({
      buyPrice: 7000,
      expectedSellPrice: 10000,
      referralFeeRate: 0.1,
      sizeTier: "standard",
      holdingDays: 12.5,
      costs: {
        ...costs,
        fbaFeeByTier: { ...costs.fbaFeeByTier, standard: 400 },
        storageFeePerDay: 8, // 12.5日 → 100円
        pointsBackRate: 0.0571, // 7,000円に対し約400円
        inboundCostPerUnit: 0,
      },
    });

    expect(p.referralFee).toBe(1000);
    expect(p.fbaFee).toBe(400);
    expect(p.storageFee).toBe(100);
    expect(p.returnsAllowance).toBe(200);
    expect(p.netProceeds).toBe(8300); // 手取り額
    expect(p.pointsBack).toBe(400);
    expect(p.acquisitionCost).toBe(6600);
    expect(p.netProfit).toBe(1700); // 純利益
    expect(p.roi).toBeCloseTo(1700 / 6600, 5);
  });

  it("改訂仕様 T01：仕入7,200・売価10,200 → 貢献利益470・ROI 6.3%", () => {
    const p = calcProfit({
      buyPrice: 7200,
      expectedSellPrice: 10200,
      referralFeeRate: 0.15,
      sizeTier: "standard",
      holdingDays: 12.5, // 保管 100円（8円×12.5）
      costs: {
        ...costs,
        inboundCostPerUnit: 250,
        pointsBackRate: 0,
        returnsRate: 150 / 10200,
        storageFeePerDay: 8,
        fbaFeeByTier: { ...costs.fbaFeeByTier, standard: 500 },
      },
    });
    expect(p.referralFee).toBe(1530);
    expect(p.fbaFee).toBe(500);
    expect(p.storageFee).toBe(100);
    expect(p.returnsAllowance).toBe(150);
    expect(p.acquisitionCost).toBe(7450);
    expect(p.netProfit).toBe(470);
    expect(p.roi).toBeCloseTo(0.063, 3);
  });

  it("仕入上限は必要利益と最低ROIの双方を満たす最大額", () => {
    const max = calcMaxBuyPrice({
      expectedSellPrice: 10200,
      referralFeeRate: 0.15,
      sizeTier: "standard",
      holdingDays: 12.5,
      costs: {
        ...costs,
        inboundCostPerUnit: 250,
        pointsBackRate: 0,
        returnsRate: 150 / 10200,
        storageFeePerDay: 8,
        fbaFeeByTier: { ...costs.fbaFeeByTier, standard: 500 },
      },
      minNetProfit: 470,
      minRoi: 0.063,
    });
    expect(max).toBeGreaterThanOrEqual(7200);
    expect(max).toBeLessThanOrEqual(7300);
  });

  it("手数料を引くと赤字になる案件を、見かけの値引き率に騙されず赤字と判定する", () => {
    // 30%引きに見えるが、手数料と原価で負ける
    const p = calcProfit({
      buyPrice: 2100,
      expectedSellPrice: 3000,
      referralFeeRate: 0.15,
      sizeTier: "standard",
      holdingDays: 30,
      costs,
    });
    expect(p.expectedSellPrice - p.buyPrice).toBe(900); // 見かけの差益
    expect(p.netProfit).toBeLessThan(0); // 実際は赤字
  });

  it("保有日数が延びるほど保管料で利益が削られる", () => {
    const base = { buyPrice: 5000, expectedSellPrice: 8000, referralFeeRate: 0.1, sizeTier: "standard" as const, costs };
    const short = calcProfit({ ...base, holdingDays: 10 });
    const long = calcProfit({ ...base, holdingDays: 90 });
    expect(long.netProfit).toBeLessThan(short.netProfit);
    expect(short.netProfit - long.netProfit).toBe(80 * costs.storageFeePerDay);
  });
});

describe("calcVelocity — 売れるまでの日数と確率", () => {
  it("E[h] = n / μ", () => {
    const v = calcVelocity({ salesPerDay: 2, offerCount: 6, horizonDays: 30 });
    expect(v.expectedDays).toBeCloseTo(3, 6);
  });

  it("ps(h) = 1 − exp(−μh/n)", () => {
    const v = calcVelocity({ salesPerDay: 1, offerCount: 10, horizonDays: 10 });
    expect(v.sellProbability).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it("売れた形跡がない商品は確率0・日数無限", () => {
    const v = calcVelocity({ salesPerDay: 0, offerCount: 3, horizonDays: 45 });
    expect(v.sellProbability).toBe(0);
    expect(v.expectedDays).toBe(Number.POSITIVE_INFINITY);
  });

  it("競合が増えるほど自分の番は遠のく", () => {
    const few = calcVelocity({ salesPerDay: 3, offerCount: 2, horizonDays: 30 });
    const many = calcVelocity({ salesPerDay: 3, offerCount: 20, horizonDays: 30 });
    expect(many.expectedDays).toBeGreaterThan(few.expectedDays);
    expect(many.sellProbability).toBeLessThan(few.sellProbability);
  });
});

describe("期待値と年率換算", () => {
  it("E[π] = ps·π − (1−ps)·Lcut", () => {
    expect(expectedProfit(1000, 0.8, 660)).toBeCloseTo(0.8 * 1000 - 0.2 * 660, 6);
  });

  it("年率換算は回転の速さを正しく評価する（薄利高回転 > 厚利低回転）", () => {
    const fast = annualizedReturn(350, 7000, 10); // 5% を10日で
    const slow = annualizedReturn(1400, 7000, 120); // 20% を120日で
    expect(fast).toBeGreaterThan(slow);
  });

  it("極端な短期回転でも上限（週1回転）で頭打ちにする", () => {
    const r = annualizedReturn(100, 1000, 0.5);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeCloseTo(Math.pow(1.1, 52) - 1, 6);
  });

  it("期待値がマイナスでも計算が壊れない", () => {
    expect(annualizedReturn(-5000, 1000, 30)).toBe(-1);
  });
});

describe("信頼度 κ とリスク係数 φ", () => {
  it("履歴が長く新しいほど信頼度が上がる", () => {
    const good = calcConfidence({ historyDays: 120, sampleCount: 300, ageMinutes: 5 });
    const poor = calcConfidence({ historyDays: 5, sampleCount: 10, ageMinutes: 2000 });
    expect(good).toBeGreaterThan(0.9);
    expect(poor).toBeLessThan(0.2);
  });

  it("出品制限のある商品は φ = 0（候補から外れる）", () => {
    expect(calcRiskFactor({ restricted: true, priceVolatility: 0.05, offerCount: 3, pattern: "timesale" })).toBe(0);
  });

  it("値動きが荒い・競合が多いほど割り引かれる", () => {
    const calm = calcRiskFactor({ restricted: false, priceVolatility: 0.02, offerCount: 3, pattern: "timesale" });
    const wild = calcRiskFactor({ restricted: false, priceVolatility: 0.4, offerCount: 30, pattern: "demand" });
    expect(calm).toBeGreaterThan(wild);
  });
});

describe("evaluate — 通知の門番", () => {
  const base = {
    buyPrice: 7000,
    expectedSellPrice: 10000,
    referralFeeRate: 0.1,
    sizeTier: "standard" as const,
    salesPerDay: 1.2,
    offerCount: 6,
    restricted: false,
    priceVolatility: 0.06,
    historyDays: 120,
    sampleCount: 260,
    ageMinutes: 3,
    pattern: "timesale" as const,
    median90: 9900,
    costs,
    thresholds,
    perItemCap: 50000,
  };

  it("良い案件は通過し、スコアが正になる", () => {
    const e = evaluate(base);
    expect(e.passed).toBe(true);
    expect(e.reasons).toHaveLength(0);
    expect(e.netProfit).toBeGreaterThan(thresholds.minNetProfit);
    expect(e.roi).toBeGreaterThan(thresholds.minRoi);
    expect(e.score).toBeGreaterThan(0);
    expect(e.suggestedQty).toBeGreaterThanOrEqual(1);
  });

  it("利益が薄い案件は理由つきで落とす", () => {
    const e = evaluate({ ...base, expectedSellPrice: 7600 });
    expect(e.passed).toBe(false);
    expect(e.reasons.join()).toMatch(/純利益|利益率/);
  });

  it("売れない商品は落とす", () => {
    const e = evaluate({ ...base, salesPerDay: 0.02, offerCount: 12 });
    expect(e.passed).toBe(false);
    expect(e.reasons.join()).toMatch(/売れるまで/);
  });

  it("出品制限のある商品は必ず落とす", () => {
    const e = evaluate({ ...base, restricted: true, restrictedReason: "要許可カテゴリ" });
    expect(e.passed).toBe(false);
    expect(e.score).toBe(0);
    expect(e.suggestedQty).toBe(0);
    expect(e.reasons.join()).toMatch(/出品ゲート|出品制限/);
  });

  it("出品ゲート UNKNOWN は推奨数0で落とす", () => {
    const e = evaluate({ ...base, listingGate: "UNKNOWN" });
    expect(e.passed).toBe(false);
    expect(e.suggestedQty).toBe(0);
    expect(e.judgment).toBe("skip");
  });

  it("履歴が乏しい商品は信頼度で落とす", () => {
    const e = evaluate({ ...base, historyDays: 3, sampleCount: 5, ageMinutes: 600 });
    expect(e.passed).toBe(false);
    expect(e.reasons.join()).toMatch(/信頼度/);
  });

  it("資金配分の上限を超える単価は落とす", () => {
    const e = evaluate({ ...base, perItemCap: 1000 });
    expect(e.passed).toBe(false);
    expect(e.reasons.join()).toMatch(/資金配分/);
  });

  it("通過しても注意点は警告として残す", () => {
    const e = evaluate({ ...base, offerCount: 18, priceVolatility: 0.3 });
    expect(e.warnings.length).toBeGreaterThan(0);
  });
});

describe("資金配分", () => {
  it("ケリー基準の式どおりに計算する", () => {
    const f = kellyFraction(1000, 500, 0.8);
    const b = 2;
    expect(f).toBeCloseTo((b * 0.8 - 0.2) / b, 6);
  });

  it("期待値が負なら投下しない", () => {
    expect(kellyFraction(-100, 500, 0.5)).toBe(0);
  });

  it("いちばん厳しい制約が上限になる（1銘柄5%）", () => {
    const r = allocate({
      capital: {
        workingCapital: 1000000,
        kellyFraction: 0.25,
        maxPerItemRatio: 0.05,
        maxPerCategoryRatio: 0.3,
        cashReserveRatio: 0.2,
      },
      deployedTotal: 0,
      deployedInCategory: 0,
      netProfit: 5000,
      stopLoss: 700,
      sellProbability: 0.9,
    });
    expect(r.perItemCap).toBe(50000);
    expect(r.limitedBy).toBe("item");
  });

  it("現金留保20%を割り込む投下はできない", () => {
    const r = allocate({
      capital: {
        workingCapital: 1000000,
        kellyFraction: 0.25,
        maxPerItemRatio: 0.05,
        maxPerCategoryRatio: 0.3,
        cashReserveRatio: 0.2,
      },
      deployedTotal: 795000,
      deployedInCategory: 0,
      netProfit: 5000,
      stopLoss: 700,
      sellProbability: 0.9,
    });
    expect(r.availableCash).toBe(5000);
    expect(r.perItemCap).toBe(5000);
    expect(r.limitedBy).toBe("cash");
  });
});

describe("出口判定", () => {
  const ctx = {
    acquisitionCost: 6600,
    targetPrice: 10000,
    stopPrice: 5940, // 6600 × 0.9
    currentPrice: 9000,
    peakPrice: 9500,
    holdingDays: 12,
    median90: 9900,
    buyPrice: 7000,
    offerCount: 6,
    baselineOfferCount: 6,
    salesRankTrend: 0,
    storageAccrued: 100,
    expectedNetProfit: 1700,
    thresholds,
  };

  it("平常時はシグナルを出さない", () => {
    expect(evaluateExit(ctx)).toHaveLength(0);
  });

  it("E-2 目標到達で利確を提示", () => {
    const s = evaluateExit({ ...ctx, currentPrice: 10200 });
    expect(s.some((x) => x.rule === "E-2" && x.kind === "take_profit")).toBe(true);
  });

  it("E-1 相場が戻ったら値引き終了とみなす", () => {
    const s = evaluateExit({ ...ctx, currentPrice: 9800 });
    expect(s.some((x) => x.rule === "E-1")).toBe(true);
  });

  it("E-3 最高値から12%下落でトレーリング利確", () => {
    const s = evaluateExit({ ...ctx, peakPrice: 11000, currentPrice: 9000 });
    expect(s.some((x) => x.rule === "E-3")).toBe(true);
  });

  it("X-2 原価−10%割れで損切りを提示（最優先）", () => {
    const s = evaluateExit({ ...ctx, currentPrice: 5000 });
    expect(s[0].rule).toBe("X-2");
    expect(s[0].kind).toBe("stop_loss");
  });

  it("X-1 60日で値下げ、90日で成行", () => {
    expect(evaluateExit({ ...ctx, holdingDays: 65 }).some((x) => x.rule === "X-1")).toBe(true);
    const forced = evaluateExit({ ...ctx, holdingDays: 95 }).find((x) => x.rule === "X-1");
    expect(forced?.message).toMatch(/成行/);
  });

  it("X-3 競合が倍増したら撤退を提示", () => {
    const s = evaluateExit({ ...ctx, offerCount: 14, baselineOfferCount: 6 });
    expect(s.some((x) => x.rule === "X-3")).toBe(true);
  });

  it("X-4 保管費が利益の30%を超えたら知らせる", () => {
    const s = evaluateExit({ ...ctx, storageAccrued: 600 });
    expect(s.some((x) => x.rule === "X-4")).toBe(true);
  });

  it("段階的値下げは60日から始まり90日で下限に届く", () => {
    expect(steppedPrice(10000, 7000, 30, thresholds)).toBe(10000);
    expect(steppedPrice(10000, 7000, 75, thresholds)).toBe(8500);
    expect(steppedPrice(10000, 7000, 90, thresholds)).toBe(7000);
  });
});
