import { calcProfit } from "./profit";
import type { CostSettings, SizeTier } from "./types";

/**
 * バックテスト（過去6〜12ヶ月の観測で「その条件で買っていたらどうだったか」を検証する）。
 *
 * 大事にしていること：
 *  - **先読みをしない**。エントリー判定に使う中央値は、その時点より前の観測だけで作る。
 *    未来の値を混ぜると勝率がいくらでも良く見えてしまう。
 *  - 手数料は本番と同じ calcProfit を通す。検証と実運用で利益の定義がずれないようにする。
 *  - 建玉は重ねない。1件を売り切ってから次のエントリーを探す（資金を無限に使えるように見せない）。
 *  - 決着がつかなかった取引は勝率に混ぜず、別に数える。
 */

/** 検証に使う1件の観測 */
export interface BacktestObservation {
  observedAt: string;
  /** 仕入れられた価格 */
  buyPrice: number | null;
  /** そのときの市場価格 */
  sellPrice: number | null;
  inStock?: boolean;
}

export interface BacktestParams {
  /** エントリー条件：中央値からこの割合以上下がっていたら買う（0.15 = 15%） */
  minDiscountRate: number;
  /** 中央値を取る窓（日） */
  medianWindowDays: number;
  /** 利確：取得原価に対する目標利益率 */
  targetProfitRate: number;
  /** 損切り：取得原価に対する下落率（負値。-0.10 = −10%） */
  stopLossRate: number;
  /** 時間損切り（日）。ここを過ぎたらその時点の市場価格で手仕舞う */
  timeStopDays: number;
}

export type ExitReason = "target" | "stop_loss" | "time_stop" | "open";

export interface BacktestTrade {
  entryAt: string;
  exitAt: string | null;
  buyPrice: number;
  /** 手仕舞った価格（未決なら null） */
  exitPrice: number | null;
  netProfit: number;
  roi: number;
  holdingDays: number;
  exitReason: ExitReason;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** 決着がついた取引の件数 */
  closed: number;
  /** 決着がつかなかった件数（期間の終わりに残ったもの） */
  open: number;
  /** 勝率（決着がついたもののうち利益が出た割合） */
  winRate: number | null;
  /** 平均利益率 */
  avgRoi: number | null;
  /** 平均保有日数 */
  avgHoldingDays: number | null;
  /** いちばん大きかった損失（円・負値） */
  maxLoss: number | null;
  /** 負けたときの平均損失（円・負値） */
  avgLoss: number | null;
  /** 総利益 / 総損失 */
  profitFactor: number | null;
  totalProfit: number;
  /** 検証できた期間（日） */
  coverageDays: number;
  /** 使えた観測の件数 */
  sampleCount: number;
}

export const DEFAULT_BACKTEST_PARAMS: BacktestParams = {
  minDiscountRate: 0.15,
  medianWindowDays: 90,
  targetProfitRate: 0.15,
  stopLossRate: -0.1,
  timeStopDays: 60,
};

const DAY_MS = 86_400_000;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const emptyResult = (sampleCount: number, coverageDays: number): BacktestResult => ({
  trades: [],
  closed: 0,
  open: 0,
  winRate: null,
  avgRoi: null,
  avgHoldingDays: null,
  maxLoss: null,
  avgLoss: null,
  profitFactor: null,
  totalProfit: 0,
  coverageDays,
  sampleCount,
});

export interface BacktestInput {
  observations: BacktestObservation[];
  referralFeeRate: number;
  sizeTier: SizeTier;
  costs: CostSettings;
  params?: Partial<BacktestParams>;
}

/**
 * 過去の観測をなぞって売買を再現する。
 * 観測が少なければ何も返さない（少ない標本で勝率を語らない）。
 */
export function backtest(input: BacktestInput): BacktestResult {
  const params = { ...DEFAULT_BACKTEST_PARAMS, ...input.params };

  const rows = input.observations
    .filter((o) => o.buyPrice != null && o.buyPrice > 0 && o.sellPrice != null && o.sellPrice > 0)
    .map((o) => ({
      time: new Date(o.observedAt).getTime(),
      buyPrice: o.buyPrice as number,
      sellPrice: o.sellPrice as number,
      inStock: o.inStock ?? true,
      observedAt: o.observedAt,
    }))
    .filter((o) => Number.isFinite(o.time))
    .sort((a, b) => a.time - b.time);

  const coverageDays = rows.length >= 2 ? (rows[rows.length - 1].time - rows[0].time) / DAY_MS : 0;
  if (rows.length < 2) return emptyResult(rows.length, coverageDays);

  const trades: BacktestTrade[] = [];
  let i = 0;

  while (i < rows.length) {
    const entry = rows[i];

    // その時点より前だけを見て「ふだんの価格」を出す（先読み防止）
    const windowStart = entry.time - params.medianWindowDays * DAY_MS;
    const past = rows
      .slice(0, i)
      .filter((o) => o.time >= windowStart)
      .map((o) => o.sellPrice);
    const baseline = median(past);

    if (!baseline || !entry.inStock) {
      i += 1;
      continue;
    }

    const discount = 1 - entry.buyPrice / baseline;
    if (discount < params.minDiscountRate) {
      i += 1;
      continue;
    }

    // 買ったとみなして、その先の観測で手仕舞いを探す
    const priced = calcProfit({
      buyPrice: entry.buyPrice,
      expectedSellPrice: baseline,
      referralFeeRate: input.referralFeeRate,
      sizeTier: input.sizeTier,
      holdingDays: 0,
      costs: input.costs,
    });
    const acquisitionCost = priced.acquisitionCost;
    const targetPrice = acquisitionCost * (1 + params.targetProfitRate);
    const stopPrice = acquisitionCost * (1 + params.stopLossRate);

    let exitIndex: number | null = null;
    let exitReason: ExitReason = "open";

    for (let j = i + 1; j < rows.length; j++) {
      const held = (rows[j].time - entry.time) / DAY_MS;
      if (rows[j].sellPrice >= targetPrice) {
        exitIndex = j;
        exitReason = "target";
        break;
      }
      if (rows[j].sellPrice <= stopPrice) {
        exitIndex = j;
        exitReason = "stop_loss";
        break;
      }
      if (held >= params.timeStopDays) {
        exitIndex = j;
        exitReason = "time_stop";
        break;
      }
    }

    if (exitIndex === null) {
      trades.push({
        entryAt: entry.observedAt,
        exitAt: null,
        buyPrice: entry.buyPrice,
        exitPrice: null,
        netProfit: 0,
        roi: 0,
        holdingDays: (rows[rows.length - 1].time - entry.time) / DAY_MS,
        exitReason: "open",
      });
      break; // これ以降は決着させられない
    }

    const exit = rows[exitIndex];
    const holdingDays = (exit.time - entry.time) / DAY_MS;
    const settled = calcProfit({
      buyPrice: entry.buyPrice,
      expectedSellPrice: exit.sellPrice,
      referralFeeRate: input.referralFeeRate,
      sizeTier: input.sizeTier,
      holdingDays,
      costs: input.costs,
    });

    trades.push({
      entryAt: entry.observedAt,
      exitAt: exit.observedAt,
      buyPrice: entry.buyPrice,
      exitPrice: exit.sellPrice,
      netProfit: settled.netProfit,
      roi: settled.roi,
      holdingDays,
      exitReason,
    });

    // 売り切ってから次を探す（建玉を重ねない）
    i = exitIndex + 1;
  }

  return summarize(trades, rows.length, coverageDays);
}

function summarize(
  trades: BacktestTrade[],
  sampleCount: number,
  coverageDays: number,
): BacktestResult {
  const closed = trades.filter((t) => t.exitReason !== "open");
  const open = trades.length - closed.length;

  if (closed.length === 0) {
    return { ...emptyResult(sampleCount, coverageDays), trades, open };
  }

  const wins = closed.filter((t) => t.netProfit > 0);
  const losses = closed.filter((t) => t.netProfit < 0);
  const grossProfit = wins.reduce((a, t) => a + t.netProfit, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netProfit, 0));

  return {
    trades,
    closed: closed.length,
    open,
    winRate: wins.length / closed.length,
    avgRoi: closed.reduce((a, t) => a + t.roi, 0) / closed.length,
    avgHoldingDays: closed.reduce((a, t) => a + t.holdingDays, 0) / closed.length,
    maxLoss: losses.length ? Math.min(...losses.map((t) => t.netProfit)) : null,
    avgLoss: losses.length ? losses.reduce((a, t) => a + t.netProfit, 0) / losses.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    totalProfit: closed.reduce((a, t) => a + t.netProfit, 0),
    coverageDays,
    sampleCount,
  };
}

/** 検証結果を信用してよいか。標本が少ないときに勝率を語らせないための目安。 */
export function isReliable(result: BacktestResult, minTrades = 5, minDays = 180): boolean {
  return result.closed >= minTrades && result.coverageDays >= minDays;
}
