import type { ThresholdSettings } from "./types";

export type ExitKind = "take_profit" | "stop_loss";

export interface ExitSignal {
  rule: "E-1" | "E-2" | "E-3" | "E-4" | "X-1" | "X-2" | "X-3" | "X-4";
  kind: ExitKind;
  message: string;
  /** 大きいほど優先して提示する */
  severity: number;
}

export interface ExitContext {
  /** 1個あたり実質取得原価 Ca */
  acquisitionCost: number;
  targetPrice: number;
  /** 価格損切りライン（Ca × (1 + stopLossRate)） */
  stopPrice: number;
  /** 現在の市場価格（最安値） */
  currentPrice: number;
  /** 保有してからの観測最高値 */
  peakPrice: number | null;
  holdingDays: number;
  /** 90日中央値（値引き終了の判定に使う） */
  median90: number | null;
  /** 買ったときの仕入価格 */
  buyPrice: number;
  offerCount: number;
  /** 買った時点の競合数 */
  baselineOfferCount: number;
  salesRankTrend: number; // 負 = ランキング改善（売れている）
  /** これまでに発生した累計保管料 */
  storageAccrued: number;
  /** 買ったときに見込んでいた純利益 */
  expectedNetProfit: number;
  thresholds: ThresholdSettings;
}

/**
 * 提案書 3.5節の出口判定。
 *
 *   利確  E-1 値引きが終わった / E-2 目標価格に届いた
 *         E-3 トレーリング（最高値から δ 下落）/ E-4 需要ピーク
 *   損切り X-1 時間（60日で値下げ・90日で成行）
 *         X-2 価格（原価 −10% 割れ）
 *         X-3 イベント（競合急増・公式値下げ）
 *         X-4 保管費（利益の30%超）
 *
 * 判定は毎日おこない、感情を挟まずに提示する。
 */
export function evaluateExit(ctx: ExitContext): ExitSignal[] {
  const t = ctx.thresholds;
  const out: ExitSignal[] = [];
  const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

  // ---- 損切り -------------------------------------------------------
  // X-2 価格損切り: 現在価格が原価 −10% を割った
  if (ctx.currentPrice > 0 && ctx.currentPrice < ctx.stopPrice) {
    out.push({
      rule: "X-2",
      kind: "stop_loss",
      severity: 100,
      message: `価格が損切りライン ${yen(ctx.stopPrice)} を下回りました（現在 ${yen(ctx.currentPrice)}）。撤退を検討してください。`,
    });
  }

  // X-1 時間損切り
  if (ctx.holdingDays >= t.forceSellDays) {
    out.push({
      rule: "X-1",
      kind: "stop_loss",
      severity: 95,
      message: `保有 ${Math.floor(ctx.holdingDays)}日。${t.forceSellDays}日を超えたため成行での現金化を推奨します。`,
    });
  } else if (ctx.holdingDays >= t.timeStopDays) {
    out.push({
      rule: "X-1",
      kind: "stop_loss",
      severity: 60,
      message: `保有 ${Math.floor(ctx.holdingDays)}日。${t.timeStopDays}日を超えたため段階的な値下げを開始してください。`,
    });
  }

  // X-3 イベント損切り: 競合が急増した / 仕入値そのものが下がった
  if (ctx.baselineOfferCount > 0 && ctx.offerCount >= ctx.baselineOfferCount * 2 && ctx.offerCount >= 5) {
    out.push({
      rule: "X-3",
      kind: "stop_loss",
      severity: 80,
      message: `競合が ${ctx.baselineOfferCount}社 → ${ctx.offerCount}社 に増えました。値崩れの前に売却を検討してください。`,
    });
  }
  if (ctx.median90 && ctx.median90 < ctx.buyPrice) {
    out.push({
      rule: "X-3",
      kind: "stop_loss",
      severity: 75,
      message: `相場（90日中央値 ${yen(ctx.median90)}）が仕入価格 ${yen(ctx.buyPrice)} を下回りました。値引きが恒久化した可能性があります。`,
    });
  }

  // X-4 保管費損切り
  if (ctx.expectedNetProfit > 0 && ctx.storageAccrued > ctx.expectedNetProfit * t.storageRatioCap) {
    out.push({
      rule: "X-4",
      kind: "stop_loss",
      severity: 55,
      message: `累計保管料 ${yen(ctx.storageAccrued)} が想定利益の ${(t.storageRatioCap * 100).toFixed(0)}% を超えました。保有し続ける利点が薄れています。`,
    });
  }

  // ---- 利確 ---------------------------------------------------------
  // E-2 目標価格に到達
  if (ctx.currentPrice >= ctx.targetPrice) {
    out.push({
      rule: "E-2",
      kind: "take_profit",
      severity: 90,
      message: `目標価格 ${yen(ctx.targetPrice)} に到達しました（現在 ${yen(ctx.currentPrice)}）。利益を確定できます。`,
    });
  }

  // E-1 値引きが終わって相場が戻った
  if (ctx.median90 && ctx.currentPrice >= ctx.median90 * 0.98 && ctx.currentPrice > ctx.buyPrice * 1.1) {
    out.push({
      rule: "E-1",
      kind: "take_profit",
      severity: 85,
      message: `価格が通常水準（90日中央値 ${yen(ctx.median90)}）まで戻りました。値引きの終了とみられます。`,
    });
  }

  // E-3 トレーリング利確
  if (ctx.peakPrice && ctx.currentPrice > 0) {
    const trigger = ctx.peakPrice * (1 - t.trailingDrop);
    if (ctx.currentPrice < trigger && ctx.currentPrice > ctx.acquisitionCost) {
      out.push({
        rule: "E-3",
        kind: "take_profit",
        severity: 70,
        message: `最高値 ${yen(ctx.peakPrice)} から ${(t.trailingDrop * 100).toFixed(0)}% 下落しました。利益の目減りを防ぐため売却を推奨します。`,
      });
    }
  }

  // E-4 需要ピーク（ランキング急上昇 かつ 競合減少）
  if (ctx.salesRankTrend < -0.2 && ctx.offerCount <= ctx.baselineOfferCount) {
    out.push({
      rule: "E-4",
      kind: "take_profit",
      severity: 50,
      message: "売れ行きが急に良くなっています。強気の価格設定が狙えます。",
    });
  }

  return out.sort((a, b) => b.severity - a.severity);
}

/** 段階的値下げ: 時間損切り発動後、下限価格まで日数に応じて下げる */
export function steppedPrice(
  listPrice: number,
  floorPrice: number,
  holdingDays: number,
  t: ThresholdSettings,
): number {
  if (holdingDays < t.timeStopDays) return listPrice;
  if (holdingDays >= t.forceSellDays) return floorPrice;
  const span = t.forceSellDays - t.timeStopDays;
  const ratio = (holdingDays - t.timeStopDays) / span;
  return Math.round(listPrice - (listPrice - floorPrice) * ratio);
}
