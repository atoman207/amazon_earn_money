import type { ThresholdSettings } from "./types";

/**
 * 実績から閾値の見直しを提案する（⑧ 改善）。
 *
 * 勝手に設定を書き換えることはしない。「この数字をこう変えてはどうか、根拠はこれ」
 * までを出して、変えるかどうかは人が決める。自動で締めたり緩めたりすると、
 * なぜそうなったのか誰にも分からなくなるため。
 */

export interface SaleOutcome {
  realizedProfit: number;
  holdingDays: number;
  /** 損になった原因 */
  failureReasonCode?: string | null;
}

export interface ImproveInput {
  sales: SaleOutcome[];
  thresholds: ThresholdSettings;
  /** これ以上の件数がないと提案しない */
  minSamples?: number;
}

export interface Suggestion {
  /** 変更を提案する設定のキー */
  key: keyof ThresholdSettings;
  label: string;
  current: number;
  suggested: number;
  /** なぜそう考えたか */
  reason: string;
  /** 締める方向か緩める方向か */
  direction: "tighten" | "relax";
}

export interface ImproveResult {
  /** 判断材料にした売却件数 */
  sampleCount: number;
  /** 提案を出せるだけの実績があるか */
  enough: boolean;
  winRate: number | null;
  avgHoldingDays: number | null;
  /** 損の原因の内訳（多い順） */
  failureBreakdown: Array<{ code: string; count: number }>;
  suggestions: Suggestion[];
}

const FAILURE_LABEL: Record<string, string> = {
  price_drop: "相場が下がった",
  competition: "競合が増えた",
  slow_sales: "売れ行きが遅かった",
  fee_miss: "手数料の見積り違い",
  demand_gone: "需要が消えた",
  other: "その他",
};

export const failureLabel = (code: string) => FAILURE_LABEL[code] ?? code;

const round = (n: number, digits = 2) => Number(n.toFixed(digits));

/**
 * 実績を読んで、閾値をどう動かすと良さそうかを出す。
 * 数字の根拠が説明できるものだけを提案する。
 */
export function suggestThresholds(input: ImproveInput): ImproveResult {
  const { sales, thresholds } = input;
  const minSamples = input.minSamples ?? 10;

  const wins = sales.filter((s) => s.realizedProfit > 0);
  const losses = sales.filter((s) => s.realizedProfit < 0);
  const winRate = sales.length ? wins.length / sales.length : null;
  const avgHoldingDays = sales.length
    ? sales.reduce((a, s) => a + s.holdingDays, 0) / sales.length
    : null;

  const counts = new Map<string, number>();
  for (const s of losses) {
    const code = s.failureReasonCode ?? "other";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const failureBreakdown = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const result: ImproveResult = {
    sampleCount: sales.length,
    enough: sales.length >= minSamples,
    winRate,
    avgHoldingDays,
    failureBreakdown,
    suggestions: [],
  };

  if (!result.enough) return result;

  // ---- 勝率が低い → 利益の下限を上げて、通す数を絞る ----
  if (winRate !== null && winRate < 0.5) {
    result.suggestions.push({
      key: "minNetProfit",
      label: "最低純利益",
      current: thresholds.minNetProfit,
      suggested: Math.round(thresholds.minNetProfit * 1.2),
      direction: "tighten",
      reason: `勝率が ${(winRate * 100).toFixed(0)}%（${wins.length}/${sales.length}件）と半分を下回っています。利益の下限を上げて、薄い案件を通さないようにします。`,
    });
  }

  // ---- 勝率が高く回転も速い → 少し緩めて機会を増やす ----
  if (
    winRate !== null &&
    winRate >= 0.75 &&
    avgHoldingDays !== null &&
    avgHoldingDays < thresholds.maxExpectedDays * 0.6
  ) {
    result.suggestions.push({
      key: "minNetProfit",
      label: "最低純利益",
      current: thresholds.minNetProfit,
      suggested: Math.max(100, Math.round(thresholds.minNetProfit * 0.9)),
      direction: "relax",
      reason: `勝率 ${(winRate * 100).toFixed(0)}%、平均保有 ${avgHoldingDays.toFixed(0)}日と余裕があります。下限を少し下げると機会を増やせます。`,
    });
  }

  // ---- 実際の保有日数が想定より長い → 期待保有日数の上限を実態に寄せる ----
  if (avgHoldingDays !== null && avgHoldingDays > thresholds.maxExpectedDays) {
    result.suggestions.push({
      key: "maxExpectedDays",
      label: "期待保有日数の上限",
      current: thresholds.maxExpectedDays,
      suggested: Math.ceil(avgHoldingDays),
      direction: "relax",
      reason: `実際の平均保有は ${avgHoldingDays.toFixed(0)}日で、上限 ${thresholds.maxExpectedDays}日を超えています。上限が実態と合っていません。`,
    });
  }

  // ---- 売れ行きの読み違いが多い → 保有日数を短く見積もる ----
  const slow = counts.get("slow_sales") ?? 0;
  if (slow >= 2 && slow >= losses.length * 0.4) {
    result.suggestions.push({
      key: "maxExpectedDays",
      label: "期待保有日数の上限",
      current: thresholds.maxExpectedDays,
      suggested: Math.max(7, Math.round(thresholds.maxExpectedDays * 0.8)),
      direction: "tighten",
      reason: `損失 ${losses.length}件のうち ${slow}件が「売れ行きが遅かった」でした。回転の見積りを厳しくします。`,
    });
  }

  // ---- 相場下落・競合増加で負けている → 損切りを浅くして傷を小さくする ----
  const marketLosses = (counts.get("price_drop") ?? 0) + (counts.get("competition") ?? 0);
  if (marketLosses >= 2 && marketLosses >= losses.length * 0.5) {
    result.suggestions.push({
      key: "stopLossRate",
      label: "価格損切りライン",
      current: thresholds.stopLossRate,
      suggested: round(Math.min(-0.03, thresholds.stopLossRate + 0.03)),
      direction: "tighten",
      reason: `損失の ${marketLosses}/${losses.length}件が相場下落・競合増加によるものです。損切りを浅くすると1件あたりの傷が小さくなります。`,
    });
  }

  // ---- 手数料の読み違いが多い → 利益率の下限を上げて余裕を持たせる ----
  const feeMiss = counts.get("fee_miss") ?? 0;
  if (feeMiss >= 2) {
    result.suggestions.push({
      key: "minRoi",
      label: "最低利益率",
      current: thresholds.minRoi,
      suggested: round(thresholds.minRoi + 0.02),
      direction: "tighten",
      reason: `「手数料の見積り違い」が ${feeMiss}件あります。利益率の下限を上げて、見積りのぶれを吸収します。`,
    });
  }

  return result;
}
