import { steppedPrice } from "./exit";
import type { ExitSignal } from "./exit";
import type { ThresholdSettings } from "./types";

/**
 * 再販売の提案（⑦）。
 *
 * 出口シグナルは「売るべきかどうか」までしか言わない。
 * 実際に動くには「いくらで」「何個」が要るので、ここで数字にする。
 *
 *   いくらで … 出口の理由ごとに、目標価格・相場・段階値下げ後の価格から選ぶ
 *   何個   … 急ぐほど多く、様子見なら分割して出す
 *
 * 決めるのはあくまで提案までで、実行は人が承認する。
 */

export type SellUrgency = "now" | "soon" | "hold";

export interface ResellContext {
  /** 1個あたり実質取得原価 */
  acquisitionCost: number;
  targetPrice: number;
  /** 価格損切りライン */
  stopPrice: number;
  currentPrice: number;
  /** 90日中央値。相場に戻す価格の目安 */
  median90: number | null;
  qty: number;
  holdingDays: number;
  signals: ExitSignal[];
  thresholds: ThresholdSettings;
}

export interface ResellPlan {
  urgency: SellUrgency;
  /** 提案する売却価格 */
  price: number;
  /** 提案する売却数量 */
  qty: number;
  /** 1個あたりの想定損益（手数料は含まない粗い目安） */
  spreadPerUnit: number;
  /** なぜこの価格・数量なのか */
  reason: string;
  /** 値下げを段階的に進めている最中か */
  stepping: boolean;
}

/** いちばん強い出口シグナルの種類で急ぎ具合を決める */
function urgencyOf(signals: ExitSignal[]): SellUrgency {
  if (signals.length === 0) return "hold";
  const top = signals[0];
  if (top.kind === "stop_loss") return "now";
  return "soon";
}

/**
 * 売却の提案を組み立てる。
 * 損切り局面では「売れる価格」を、利確局面では「高く売れる価格」を優先する。
 */
export function planResell(ctx: ResellContext): ResellPlan {
  const t = ctx.thresholds;
  const urgency = urgencyOf(ctx.signals);
  const rules = new Set(ctx.signals.map((s) => s.rule));
  const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

  // 時間損切りに入っていたら、日数に応じて段階的に下げる
  const floor = Math.max(1, Math.round(ctx.acquisitionCost * (1 + t.stopLossRate)));
  const listPrice = Math.max(ctx.targetPrice, ctx.currentPrice);
  const stepped = steppedPrice(Math.round(listPrice), floor, ctx.holdingDays, t);
  const stepping = stepped < Math.round(listPrice);

  let price: number;
  let qty: number;
  let reason: string;

  if (rules.has("X-1") && ctx.holdingDays >= t.forceSellDays) {
    // 成行：現金化を優先し、全数を相場に置く
    price = Math.max(1, Math.min(ctx.currentPrice || floor, floor));
    qty = ctx.qty;
    reason = `保有 ${Math.floor(ctx.holdingDays)}日。現金化を優先して全${ctx.qty}個を ${yen(price)} で出します。`;
  } else if (urgency === "now") {
    // 損切り：相場に合わせて全数を出す（下げ止まりを待たない）
    price = Math.max(1, Math.round(ctx.currentPrice || stepped));
    qty = ctx.qty;
    reason = `損切りの条件に触れています。全${ctx.qty}個を現在価格 ${yen(price)} で出します。`;
  } else if (rules.has("E-2") || rules.has("E-1")) {
    // 利確：目標価格まで戻っているので、まず半分を確定して残りを伸ばす
    price = Math.max(ctx.targetPrice, ctx.currentPrice);
    qty = ctx.qty >= 2 ? Math.ceil(ctx.qty / 2) : ctx.qty;
    reason =
      ctx.qty >= 2
        ? `目標価格に届いています。まず${qty}個を ${yen(price)} で確定し、残り${ctx.qty - qty}個は伸ばします。`
        : `目標価格に届いています。${yen(price)} で確定できます。`;
  } else if (rules.has("E-3")) {
    // トレーリング：下げ始めているので早めに全数
    price = Math.max(1, Math.round(ctx.currentPrice));
    qty = ctx.qty;
    reason = `高値から下げ始めています。全${ctx.qty}個を ${yen(price)} で出して利益を残します。`;
  } else if (stepping) {
    price = stepped;
    qty = ctx.qty;
    reason = `保有 ${Math.floor(ctx.holdingDays)}日。段階値下げとして ${yen(price)} まで下げます（下限 ${yen(floor)}）。`;
  } else {
    // 動く理由がない：目標価格で置いたまま待つ
    price = Math.round(ctx.targetPrice);
    qty = ctx.qty;
    reason = `売り時ではありません。目標価格 ${yen(price)} で置いたまま様子を見ます。`;
  }

  return {
    urgency,
    price: Math.round(price),
    qty: Math.max(1, Math.min(qty, ctx.qty)),
    spreadPerUnit: Math.round(price - ctx.acquisitionCost),
    reason,
    stepping,
  };
}
