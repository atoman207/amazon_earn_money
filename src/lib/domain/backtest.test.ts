import { describe, expect, it } from "vitest";
import { backtest, isReliable, type BacktestObservation } from "./backtest";
import type { CostSettings } from "./types";

const costs: CostSettings = {
  inboundCostPerUnit: 150,
  pointsBackRate: 0.005,
  returnsRate: 0.02,
  storageFeePerDay: 8,
  fbaFeeByTier: { small: 290, standard: 434, large: 603, oversize: 1000 },
};

const DAY = 86_400_000;
const start = Date.parse("2026-01-01T00:00:00.000Z");
const at = (day: number) => new Date(start + day * DAY).toISOString();

/** 指定した日の観測を作る */
const obs = (day: number, buyPrice: number, sellPrice: number): BacktestObservation => ({
  observedAt: at(day),
  buyPrice,
  sellPrice,
  inStock: true,
});

const run = (observations: BacktestObservation[], params = {}) =>
  backtest({ observations, referralFeeRate: 0.1, sizeTier: "standard", costs, params });

describe("backtest", () => {
  it("観測が足りなければ何も判定しない", () => {
    const r = run([obs(0, 5000, 10000)]);
    expect(r.closed).toBe(0);
    expect(r.winRate).toBeNull();
    expect(r.sampleCount).toBe(1);
  });

  it("中央値より下がったところで買い、目標価格まで戻ったら利確になる", () => {
    const observations = [
      // まず「ふだんの価格」を作る（相場 10,000円）
      ...Array.from({ length: 10 }, (_, i) => obs(i, 9000, 10000)),
      // 30%下がったところで買う
      obs(10, 6300, 9500),
      // 戻ったので利確
      obs(20, 9000, 12000),
    ];
    const r = run(observations);

    expect(r.closed).toBe(1);
    expect(r.trades[0].exitReason).toBe("target");
    expect(r.trades[0].buyPrice).toBe(6300);
    expect(r.trades[0].netProfit).toBeGreaterThan(0);
    expect(r.winRate).toBe(1);
    expect(r.trades[0].holdingDays).toBeCloseTo(10, 5);
  });

  it("値下がりが続けば損切りとして記録する", () => {
    const observations = [
      ...Array.from({ length: 10 }, (_, i) => obs(i, 9000, 10000)),
      obs(10, 6300, 9500),
      obs(20, 3000, 3200), // 取得原価を大きく割り込む
    ];
    const r = run(observations);

    expect(r.closed).toBe(1);
    expect(r.trades[0].exitReason).toBe("stop_loss");
    expect(r.trades[0].netProfit).toBeLessThan(0);
    expect(r.winRate).toBe(0);
    expect(r.maxLoss).toBeLessThan(0);
    expect(r.avgLoss).toBeLessThan(0);
  });

  it("決着がつかない取引は勝率に混ぜず、未決として数える", () => {
    const observations = [
      ...Array.from({ length: 10 }, (_, i) => obs(i, 9000, 10000)),
      obs(10, 6300, 9500),
      // 取得原価の −10%（約5,776円）と +15%（約7,381円）のあいだ。どちらにも触れない。
      obs(12, 6300, 6500),
    ];
    const r = run(observations);

    expect(r.open).toBe(1);
    expect(r.closed).toBe(0);
    expect(r.winRate).toBeNull();
  });

  it("エントリー判定に未来の値を使わない", () => {
    // 1件目は比較する過去が無いので、どれだけ安くても買わない
    const r = run([obs(0, 1, 10000), obs(1, 9000, 10000)]);
    expect(r.trades).toHaveLength(0);
  });

  it("建玉を重ねない（売り切ってから次を探す）", () => {
    const observations = [
      ...Array.from({ length: 10 }, (_, i) => obs(i, 9000, 10000)),
      obs(10, 6300, 9500), // 1回目のエントリー
      obs(11, 6300, 9400), // 保有中なのでここでは買わない
      obs(20, 9000, 12000), // 利確
      obs(21, 6000, 9000), // 売り切ったので次のエントリー候補になる
      obs(30, 9000, 12000),
    ];
    const r = run(observations);
    expect(r.closed).toBe(2);
    expect(r.trades[0].entryAt).toBe(at(10));
    expect(r.trades[1].entryAt).toBe(at(21));
  });

  it("時間損切りに達したらその時点の価格で手仕舞う", () => {
    const observations = [
      ...Array.from({ length: 10 }, (_, i) => obs(i, 9000, 10000)),
      obs(10, 6300, 9500),
      obs(75, 6300, 6500), // 利確にも損切りにも届かないまま60日を過ぎた
    ];
    const r = run(observations, { timeStopDays: 60 });
    expect(r.trades[0].exitReason).toBe("time_stop");
  });

  it("勝ちと負けが混ざると Profit Factor を出す", () => {
    const observations = [
      ...Array.from({ length: 10 }, (_, i) => obs(i, 9000, 10000)),
      obs(10, 6300, 9500),
      obs(20, 9000, 20000), // 大勝ち
      obs(21, 6000, 9000),
      obs(30, 3000, 3100), // 負け
    ];
    const r = run(observations);
    expect(r.closed).toBe(2);
    expect(r.profitFactor).not.toBeNull();
    expect(r.winRate).toBeCloseTo(0.5, 5);
  });
});

describe("isReliable", () => {
  it("標本が少ないうちは信用しない", () => {
    const thin = run([obs(0, 9000, 10000), obs(1, 9000, 10000)]);
    expect(isReliable(thin)).toBe(false);
  });
});
