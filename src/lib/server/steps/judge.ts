import "server-only";
import type { BacktestParams } from "@/lib/domain/backtest";
import { describeForecast } from "@/lib/domain/forecast";
import { backtestWatched, type AsinBacktest, type BacktestSummary } from "@/lib/server/backtest";
import { loadSettings } from "@/lib/server/settings";
import { analyzeUniverse, type AnalysisRow } from "@/lib/server/steps/analysis";
import type { AppSettings } from "@/lib/domain/types";

/**
 * ③ バックテスト・判定。
 *
 * 検証に使う条件は、思いつきの数字ではなく **いま設定している閾値そのもの** を使う。
 * 「この設定で去年1年やっていたらどうだったか」を出すための工程なので、
 * 設定と検証条件がずれていたら意味がない。
 */

/** 設定から検証条件を作る（画面にもそのまま出す） */
export function paramsFromSettings(settings: AppSettings): BacktestParams {
  return {
    // 値引きと呼べる深さの下限。基準価格からこれだけ下がったら買ったことにする
    minDiscountRate: 0.15,
    medianWindowDays: 90,
    // 利確は「最低利益率」を目標に置く
    targetProfitRate: settings.thresholds.minRoi,
    stopLossRate: settings.thresholds.stopLossRate,
    timeStopDays: settings.thresholds.timeStopDays,
  };
}

export interface BacktestView {
  settings: AppSettings;
  params: BacktestParams;
  summary: BacktestSummary;
  results: AsinBacktest[];
  /** 決着した取引を新しい順に並べたもの */
  trades: Array<{
    asin: string;
    entryAt: string;
    exitAt: string | null;
    buyPrice: number;
    exitPrice: number | null;
    netProfit: number;
    roi: number;
    holdingDays: number;
    exitReason: string;
  }>;
  windowDays: number;
}

export async function backtestView(windowDays = 365, limit = 60): Promise<BacktestView> {
  const settings = await loadSettings();
  const params = paramsFromSettings(settings);
  const { summary, results } = await backtestWatched(limit, windowDays, params);

  const trades = results
    .flatMap((r) => r.trades.filter((t) => t.exitReason !== "open").map((t) => ({ ...t, asin: r.asin })))
    .sort((a, b) => (b.exitAt ?? "").localeCompare(a.exitAt ?? ""))
    .slice(0, 60);

  return { settings, params, summary, results, trades, windowDays };
}

export interface ForecastRow {
  row: AnalysisRow;
  summary: string;
}

export interface ForecastView {
  rows: ForecastRow[];
  /** 予測として見せてよい材料が揃っているもの */
  reliable: number;
  horizonDays: number;
}

/**
 * 監視している商品の値動き予測を一覧にする。
 * 材料が足りないものも落とさず、reliable=false として並べる（判断の材料になるため）。
 */
export async function forecastView(horizonDays = 30, limit = 60): Promise<ForecastView> {
  const { rows } = await analyzeUniverse(limit);

  const list = rows
    .filter((r) => r.forecast)
    .map((row) => ({ row, summary: describeForecast(row.forecast!, horizonDays) }))
    .sort((a, b) => {
      // 使える予測を先に、その中では下落の大きい順（危ないものから見せる）
      if (a.row.forecast!.reliable !== b.row.forecast!.reliable) {
        return a.row.forecast!.reliable ? -1 : 1;
      }
      return (a.row.forecast!.changeRate ?? 0) - (b.row.forecast!.changeRate ?? 0);
    });

  return {
    rows: list,
    reliable: list.filter((r) => r.row.forecast?.reliable).length,
    horizonDays,
  };
}

export interface BuyRule {
  row: AnalysisRow;
  /** 仕入上限価格 */
  maxBuyPrice: number;
  /** 推奨購入数量 */
  suggestedQty: number;
  /** 目標販売価格 */
  targetPrice: number;
  /** 損切りライン */
  stopPrice: number;
  /** 期待利益（損切り込み） */
  expectedProfit: number;
  roi: number;
  /** いまの価格で条件を満たすか */
  buyable: boolean;
  /** 満たさない理由 */
  reasons: string[];
}

/** 購入条件の判定（③-3）。評価まで進めたものだけを対象にする。 */
export async function buyRules(limit = 120): Promise<{ rules: BuyRule[]; settings: AppSettings }> {
  const { rows, settings } = await analyzeUniverse(limit);

  const rules = rows
    .filter((r) => r.evaluation)
    .map((row) => {
      const e = row.evaluation!;
      return {
        row,
        maxBuyPrice: e.maxBuyPrice,
        suggestedQty: e.suggestedQty,
        targetPrice: Math.round(e.expectedSellPrice),
        stopPrice: Math.round(e.acquisitionCost * (1 + settings.thresholds.stopLossRate)),
        expectedProfit: e.expectedProfit,
        roi: e.roi,
        buyable: e.passed && e.suggestedQty > 0,
        reasons: e.reasons,
      };
    })
    .sort((a, b) => {
      if (a.buyable !== b.buyable) return a.buyable ? -1 : 1;
      return b.expectedProfit - a.expectedProfit;
    });

  return { rules, settings };
}
