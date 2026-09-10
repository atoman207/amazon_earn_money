import type { Judgment } from "./types";

/**
 * 判定と結果の答え合わせ（⑧-4）。
 *
 * 「買ってよい」と出したものが本当に利益になったか、
 * 見込んだ利益と日数がどれだけ外れたかを数える。
 *
 * ここで見たいのは勝ち負けそのものではなく「読みのズレの向き」で、
 * いつも利益を多めに見積もっているなら、手数料か販売価格の置き方が甘い。
 */

export interface DecisionOutcome {
  asin: string;
  title: string;
  judgment: Judgment | null;
  pattern: string;
  /** 判定時のデータ信頼度 */
  confidence: number;
  /** 見込んでいた純利益（数量ぶん・円） */
  predictedProfit: number;
  /** 見込んでいた保有日数 */
  predictedDays: number;
  /** 実際の確定利益（円） */
  realizedProfit: number;
  /** 実際の保有日数 */
  realizedDays: number;
}

export interface PrecisionGroup {
  key: string;
  count: number;
  /** 利益が出た割合 */
  hitRate: number;
  /** 実績 − 予測 の平均（円）。負なら見込みすぎ */
  profitGap: number;
  /** 実績 − 予測 の平均（日）。正なら思ったより時間がかかった */
  daysGap: number;
}

export interface PrecisionResult {
  count: number;
  hitRate: number | null;
  /** 実績 − 予測 の平均（円） */
  profitBias: number | null;
  /** 予測に対する誤差率の中央値 */
  profitErrorRate: number | null;
  /** 実績 − 予測 の平均（日） */
  daysBias: number | null;
  byJudgment: PrecisionGroup[];
  byPattern: PrecisionGroup[];
  byConfidence: PrecisionGroup[];
  /** 読みのズレから言えること */
  findings: string[];
  /** これだけの件数がないと語らない */
  enough: boolean;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function group(rows: DecisionOutcome[], keyOf: (r: DecisionOutcome) => string): PrecisionGroup[] {
  const map = new Map<string, DecisionOutcome[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      count: list.length,
      hitRate: list.filter((r) => r.realizedProfit > 0).length / list.length,
      profitGap: avg(list.map((r) => r.realizedProfit - r.predictedProfit)),
      daysGap: avg(list.map((r) => r.realizedDays - r.predictedDays)),
    }))
    .sort((a, b) => b.count - a.count);
}

const confidenceBucket = (c: number) =>
  c >= 0.85 ? "0.85以上（高い）" : c >= 0.7 ? "0.70〜0.85" : c >= 0.6 ? "0.60〜0.70" : "0.60未満（低い）";

const JUDGMENT_LABEL: Record<string, string> = {
  buy: "購入候補",
  pilot: "少量検証",
  review: "要確認",
  skip: "見送り",
};

export function analyzePrecision(rows: DecisionOutcome[], minSamples = 5): PrecisionResult {
  if (!rows.length) {
    return {
      count: 0,
      hitRate: null,
      profitBias: null,
      profitErrorRate: null,
      daysBias: null,
      byJudgment: [],
      byPattern: [],
      byConfidence: [],
      findings: [],
      enough: false,
    };
  }

  const hitRate = rows.filter((r) => r.realizedProfit > 0).length / rows.length;
  const profitBias = avg(rows.map((r) => r.realizedProfit - r.predictedProfit));
  const daysBias = avg(rows.map((r) => r.realizedDays - r.predictedDays));
  const errorRates = rows
    .filter((r) => Math.abs(r.predictedProfit) > 0)
    .map((r) => Math.abs(r.realizedProfit - r.predictedProfit) / Math.abs(r.predictedProfit));
  const profitErrorRate = median(errorRates);

  const byJudgment = group(rows, (r) => JUDGMENT_LABEL[r.judgment ?? ""] ?? "判定なし");
  const byPattern = group(rows, (r) => r.pattern);
  const byConfidence = group(rows, (r) => confidenceBucket(r.confidence));

  const findings: string[] = [];
  const enough = rows.length >= minSamples;
  const yen = (n: number) => Math.round(n).toLocaleString("ja-JP");

  if (enough) {
    if (profitBias < -300) {
      findings.push(
        `見込んだ利益より実績が平均 ${yen(Math.abs(profitBias))}円 少なくなっています。想定販売価格か手数料の置き方が甘い可能性があります。`,
      );
    } else if (profitBias > 300) {
      findings.push(
        `実績が見込みを平均 ${yen(profitBias)}円 上回っています。条件を厳しく見すぎて、通せる候補を落としているかもしれません。`,
      );
    }

    if (daysBias > 7) {
      findings.push(
        `実際の保有日数が見込みより平均 ${Math.round(daysBias)}日 長くなっています。売れ行きを高く見積もっています。`,
      );
    } else if (daysBias < -7) {
      findings.push(
        `実際の保有日数が見込みより平均 ${Math.abs(Math.round(daysBias))}日 短く済んでいます。回転の見積りが保守的です。`,
      );
    }

    const low = byConfidence.find((g) => g.key === "0.60未満（低い）");
    const high = byConfidence.find((g) => g.key === "0.85以上（高い）");
    if (low && high && low.count >= 3 && high.count >= 3 && high.hitRate - low.hitRate > 0.2) {
      findings.push(
        `信頼度が高いものほど勝率が高くなっています（${(high.hitRate * 100).toFixed(0)}% 対 ${(low.hitRate * 100).toFixed(0)}%）。信頼度の下限を上げる価値があります。`,
      );
    }

    const worst = [...byPattern].filter((g) => g.count >= 3).sort((a, b) => a.hitRate - b.hitRate)[0];
    if (worst && worst.hitRate < 0.4) {
      findings.push(
        `この値引きの型（${worst.key}）の勝率が ${(worst.hitRate * 100).toFixed(0)}%（${worst.count}件）と低い状態です。避けるか条件を厳しくしてください。`,
      );
    }
  }

  return {
    count: rows.length,
    hitRate,
    profitBias,
    profitErrorRate,
    daysBias,
    byJudgment,
    byPattern,
    byConfidence,
    findings,
    enough,
  };
}
