import type { ListingGate, ThresholdSettings } from "./types";

/**
 * 買う前に外すための門番（⑦-4）。
 *
 * 損切りは「買ってしまった後」の話で、いちばん効くのは最初から買わないこと。
 * ここでは1商品ぶんの材料を見て、外す理由・気をつける理由を並べる。
 *
 * 判定の方針：
 *  - 出品できない／売れた形跡が無いものは、利益がいくら大きく見えても外す（block）
 *  - 値動きの荒さ・競合の多さ・履歴の短さは、程度によって block と warn を分ける
 *  - 理由は必ず数字つきで残す。「なんとなく危ない」では次に活かせない
 */

export type ScreenLevel = "block" | "warn";

export interface ScreenCheck {
  code: string;
  label: string;
  level: ScreenLevel;
  detail: string;
}

export interface ScreenInput {
  asin: string;
  title: string;
  listingGate: ListingGate;
  restricted: boolean;
  restrictedReason?: string | null;
  /** μ 1日あたり推定販売数 */
  salesPerDay: number;
  offerCount: number;
  /** 価格の変動係数（標準偏差 / 平均） */
  volatility: number;
  historyDays: number;
  sampleCount: number;
  /** 90日中央値 */
  median90: number | null;
  /** いま仕入れられる価格 */
  buyPrice: number | null;
  /** 予測の変化率（③-2 の結果。無ければ未指定） */
  forecastChangeRate?: number | null;
  thresholds: ThresholdSettings;
}

export interface ScreenResult {
  asin: string;
  title: string;
  checks: ScreenCheck[];
  blocks: ScreenCheck[];
  warns: ScreenCheck[];
  verdict: "exclude" | "caution" | "ok";
}

const pctText = (n: number) => `${(n * 100).toFixed(1)}%`;
const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

/** 値動きの荒さの目安。これを超えると読みが立たない。 */
const VOLATILITY_WARN = 0.25;
const VOLATILITY_BLOCK = 0.4;
/** 競合数の目安 */
const OFFERS_WARN = 15;
const OFFERS_BLOCK = 25;
/** 予測が下向きのときに外す変化率 */
const FORECAST_BLOCK = -0.1;

export function screenProduct(input: ScreenInput): ScreenResult {
  const checks: ScreenCheck[] = [];

  if (input.listingGate === "FAIL" || input.restricted) {
    checks.push({
      code: "listing_gate",
      label: "出品できない",
      level: "block",
      detail: input.restrictedReason
        ? `出品ゲート FAIL（${input.restrictedReason}）`
        : "出品ゲート FAIL。許認可・証憑が揃っていません",
    });
  } else if (input.listingGate === "UNKNOWN") {
    checks.push({
      code: "listing_gate_unknown",
      label: "出品可否が未確認",
      level: "block",
      detail: "出品ゲート UNKNOWN。確認できるまで購入承認できません",
    });
  }

  if (input.salesPerDay <= 0) {
    checks.push({
      code: "no_sales",
      label: "売れた形跡がない",
      level: "block",
      detail: "販売ランキングの改善が観測されていません。売れる根拠がありません",
    });
  }

  if (input.volatility >= VOLATILITY_BLOCK) {
    checks.push({
      code: "volatility",
      label: "値動きが荒すぎる",
      level: "block",
      detail: `変動係数 ${input.volatility.toFixed(2)}（${VOLATILITY_BLOCK} 以上）。想定販売価格が立ちません`,
    });
  } else if (input.volatility >= VOLATILITY_WARN) {
    checks.push({
      code: "volatility",
      label: "値動きが大きい",
      level: "warn",
      detail: `変動係数 ${input.volatility.toFixed(2)}。目標価格に幅を持たせてください`,
    });
  }

  if (input.offerCount >= OFFERS_BLOCK) {
    checks.push({
      code: "competition",
      label: "競合が多すぎる",
      level: "block",
      detail: `出品者 ${input.offerCount}社（${OFFERS_BLOCK}社以上）。値下げ合戦になります`,
    });
  } else if (input.offerCount >= OFFERS_WARN) {
    checks.push({
      code: "competition",
      label: "競合が多い",
      level: "warn",
      detail: `出品者 ${input.offerCount}社。回転が落ちます`,
    });
  }

  if (input.historyDays < 30 || input.sampleCount < 20) {
    checks.push({
      code: "thin_history",
      label: "履歴が足りない",
      level: "warn",
      detail: `履歴 ${Math.round(input.historyDays)}日・観測 ${input.sampleCount}件。判定の信頼度が上がりません`,
    });
  }

  if (input.median90 != null && input.buyPrice != null && input.median90 < input.buyPrice) {
    checks.push({
      code: "market_below_cost",
      label: "相場が仕入値を下回る",
      level: "block",
      detail: `90日中央値 ${yen(input.median90)} < 仕入 ${yen(input.buyPrice)}。値引きが恒久化しています`,
    });
  }

  if (input.forecastChangeRate != null && input.forecastChangeRate <= FORECAST_BLOCK) {
    checks.push({
      code: "forecast_down",
      label: "下落が続く見込み",
      level: "block",
      detail: `予測で ${pctText(input.forecastChangeRate)}。買った直後に相場が下がります`,
    });
  }

  const blocks = checks.filter((c) => c.level === "block");
  const warns = checks.filter((c) => c.level === "warn");

  return {
    asin: input.asin,
    title: input.title,
    checks,
    blocks,
    warns,
    verdict: blocks.length ? "exclude" : warns.length ? "caution" : "ok",
  };
}
