import type { CapitalSettings } from "./types";

/**
 * ケリー基準 f* = (b·p − q) / b
 *   b = 勝ったときの利益 / 負けたときの損失
 *   p = 売れる確率、q = 1 − p
 * 推定誤差が大きいので、そのままは使わずフラクショナル係数を掛けて使う。
 */
export function kellyFraction(netProfit: number, stopLoss: number, sellProbability: number): number {
  const loss = Math.abs(stopLoss);
  if (loss <= 0 || netProfit <= 0) return 0;
  const b = netProfit / loss;
  const p = Math.min(1, Math.max(0, sellProbability));
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

export interface AllocationArgs {
  capital: CapitalSettings;
  /** すでに投下している総額 */
  deployedTotal: number;
  /** このカテゴリにすでに投下している額 */
  deployedInCategory: number;
  netProfit: number;
  stopLoss: number;
  sellProbability: number;
}

export interface AllocationResult {
  /** この銘柄に投下してよい上限額（円） */
  perItemCap: number;
  /** 上限を決めた理由 */
  limitedBy: "kelly" | "item" | "category" | "cash" | "none";
  kellyRaw: number;
  availableCash: number;
}

/**
 * 資金配分の上限を決める。1銘柄5%・1カテゴリ30%・現金留保30%のうち
 * いちばん厳しい制約を、フラクショナル・ケリーと組み合わせて採用する。
 */
export function allocate(a: AllocationArgs): AllocationResult {
  const { capital } = a;
  const wc = Math.max(0, capital.workingCapital);

  const investable = wc * (1 - capital.cashReserveRatio);
  const availableCash = Math.max(0, investable - a.deployedTotal);

  const kellyRaw = kellyFraction(a.netProfit, a.stopLoss, a.sellProbability);
  const kellyCap = wc * kellyRaw * capital.kellyFraction;
  const itemCap = wc * capital.maxPerItemRatio;
  const categoryCap = Math.max(0, wc * capital.maxPerCategoryRatio - a.deployedInCategory);

  const candidates: Array<[number, AllocationResult["limitedBy"]]> = [
    [kellyCap, "kelly"],
    [itemCap, "item"],
    [categoryCap, "category"],
    [availableCash, "cash"],
  ];
  candidates.sort((x, y) => x[0] - y[0]);
  const [perItemCap, limitedBy] = candidates[0];

  return {
    perItemCap: Math.max(0, Math.floor(perItemCap)),
    limitedBy: perItemCap <= 0 ? limitedBy : limitedBy,
    kellyRaw,
    availableCash,
  };
}
