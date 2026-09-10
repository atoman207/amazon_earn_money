import type {
  ConfidenceInput,
  CostSettings,
  Evaluation,
  Judgment,
  ListingGate,
  ProfitBreakdown,
  ProfitInput,
  RiskInput,
  ThresholdSettings,
  VelocityInput,
  VelocityResult,
} from "./types";

const yen = (n: number) => Math.round(n);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * 純利益の計算。提案書 3.2節の表をそのまま実装したもの。
 *
 *   Ns = Ps − 販売手数料 − 配送代行手数料 − 保管料 − 返品引当
 *   Ca = Pb × (1 − ポイント還元率) + 入庫費用
 *   π  = Ns − Ca
 *
 * 「安く買えた金額」ではなく「手数料を全部引いた後に残る金額」だけを利益とする。
 */
export function calcProfit(input: ProfitInput): ProfitBreakdown {
  const { buyPrice, expectedSellPrice: ps, referralFeeRate, sizeTier, holdingDays, costs } = input;

  const referralFee = yen(ps * referralFeeRate);
  const fbaFee = yen(costs.fbaFeeByTier[sizeTier] ?? costs.fbaFeeByTier.standard);
  const storageFee = yen(Math.max(0, holdingDays) * costs.storageFeePerDay);
  const returnsAllowance = yen(ps * costs.returnsRate);

  const netProceeds = ps - referralFee - fbaFee - storageFee - returnsAllowance;

  const pointsBack = yen(buyPrice * costs.pointsBackRate);
  const inboundCost = yen(costs.inboundCostPerUnit);
  const acquisitionCost = buyPrice - pointsBack + inboundCost;

  const netProfit = netProceeds - acquisitionCost;
  const roi = acquisitionCost > 0 ? netProfit / acquisitionCost : 0;

  return {
    expectedSellPrice: ps,
    referralFee,
    fbaFee,
    storageFee,
    returnsAllowance,
    netProceeds,
    buyPrice,
    pointsBack,
    inboundCost,
    acquisitionCost,
    netProfit,
    roi,
  };
}

/**
 * 売れるまでの日数と、期間内に売れる確率。
 *
 *   E[h] = n / μ                    （競合 n 社で分け合うと仮定）
 *   ps(h) = 1 − exp(−μ·h / n)       （ポアソン過程の近似）
 *
 * μ が 0（売れた形跡なし）のときは「売れない」と扱う。
 */
export function calcVelocity({ salesPerDay, offerCount, horizonDays }: VelocityInput): VelocityResult {
  const mu = Math.max(0, salesPerDay);
  const n = Math.max(1, offerCount);
  if (mu <= 0) return { expectedDays: Number.POSITIVE_INFINITY, sellProbability: 0 };

  const expectedDays = n / mu;
  const sellProbability = 1 - Math.exp((-mu * Math.max(0, horizonDays)) / n);
  return { expectedDays, sellProbability: clamp(sellProbability, 0, 1) };
}

/**
 * データ信頼度 κ（0〜1）。履歴が短い・観測が少ない・情報が古いものは信用しない。
 * LINE通知では★の数として表示する。
 */
export function calcConfidence({ historyDays, sampleCount, ageMinutes }: ConfidenceInput): number {
  const history = clamp(historyDays / 90, 0, 1); // 90日でフルスコア
  const samples = clamp(sampleCount / 200, 0, 1); // 200件でフルスコア
  const freshness = clamp(1 - ageMinutes / 1440, 0, 1); // 24時間で0
  return clamp(0.45 * history + 0.3 * samples + 0.25 * freshness, 0, 1);
}

/**
 * リスク調整係数 φ（0〜1）。出品制限・価格の荒さ・競合の多さで割り引く。
 */
export function calcRiskFactor({ restricted, listingGate, priceVolatility, offerCount, pattern }: RiskInput): number {
  const gate = listingGate ?? (restricted ? "FAIL" : "PASS");
  if (gate === "FAIL" || restricted) return 0;
  if (gate === "UNKNOWN") return 0;

  let phi = 1;
  phi *= clamp(1 - priceVolatility * 1.5, 0.3, 1); // 値動きが荒いほど割り引く
  phi *= clamp(1 - Math.max(0, offerCount - 5) * 0.03, 0.4, 1); // 競合が多いほど割り引く
  if (pattern === "demand") phi *= 0.85; // 需要頼みは読みにくい
  return clamp(phi, 0, 1);
}

/**
 * 仕入上限価格：必要純利益・最低ROIの双方を満たす最大仕入額。
 * 許容仕入総額 ＝ 保守的売価 − 価格依存手数料 − その他費用 − 必要利益。
 */
export function calcMaxBuyPrice(input: {
  expectedSellPrice: number;
  referralFeeRate: number;
  sizeTier: ProfitInput["sizeTier"];
  holdingDays: number;
  costs: CostSettings;
  minNetProfit: number;
  minRoi: number;
}): number {
  const referralFee = yen(input.expectedSellPrice * input.referralFeeRate);
  const fbaFee = yen(input.costs.fbaFeeByTier[input.sizeTier] ?? input.costs.fbaFeeByTier.standard);
  const storageFee = yen(Math.max(0, input.holdingDays) * input.costs.storageFeePerDay);
  const returnsAllowance = yen(input.expectedSellPrice * input.costs.returnsRate);
  const netProceeds = input.expectedSellPrice - referralFee - fbaFee - storageFee - returnsAllowance;

  const denom = 1 - input.costs.pointsBackRate;
  if (denom <= 0) return 0;

  const maxCaByProfit = netProceeds - input.minNetProfit;
  const maxCaByRoi = input.minRoi > -1 ? netProceeds / (1 + input.minRoi) : maxCaByProfit;
  const maxCa = Math.min(maxCaByProfit, maxCaByRoi);
  const maxBuy = (maxCa - input.costs.inboundCostPerUnit) / denom;
  return Math.max(0, Math.floor(maxBuy));
}

export function resolveListingGate(restricted: boolean, listingGate?: ListingGate | null): ListingGate {
  if (listingGate === "PASS" || listingGate === "FAIL" || listingGate === "UNKNOWN") return listingGate;
  return restricted ? "FAIL" : "PASS";
}

export function classifyJudgment(args: {
  passed: boolean;
  confidence: number;
  suggestedQty: number;
  listingGate: ListingGate;
  historyDays: number;
}): Judgment {
  if (args.listingGate !== "PASS") return "skip";
  if (!args.passed) return "skip";
  if (args.suggestedQty < 1) return "skip";
  if (args.confidence < 0.7 || args.historyDays < 60) return "pilot";
  if (args.confidence < 0.85) return "review";
  return "buy";
}

/**
 * 期待純利益 E[π] = ps·π − (1 − ps)·Lcut
 * Lcut は損切りしたときの損失（原価 × 損切り率）。
 */
export function expectedProfit(netProfit: number, sellProbability: number, stopLoss: number): number {
  return sellProbability * netProfit - (1 - sellProbability) * Math.abs(stopLoss);
}

/**
 * 年率換算収益率 Rann = (1 + E[π]/Ca)^(365/E[h]) − 1
 * 「利益率5%・10日で回転」と「利益率20%・120日」を同じ物差しで比べるための指標。
 */
export function annualizedReturn(expProfit: number, acquisitionCost: number, expectedDays: number): number {
  if (acquisitionCost <= 0 || !Number.isFinite(expectedDays) || expectedDays <= 0) return 0;
  const base = 1 + expProfit / acquisitionCost;
  if (base <= 0) return -1; // 全損以下は -100% 扱い
  const turns = 365 / expectedDays;
  const capped = Math.min(turns, 52); // 週1回転を上限にして極端な外挿を防ぐ
  return Math.pow(base, capped) - 1;
}

export interface EvaluateArgs {
  buyPrice: number;
  expectedSellPrice: number;
  referralFeeRate: number;
  sizeTier: ProfitInput["sizeTier"];
  salesPerDay: number;
  offerCount: number;
  restricted: boolean;
  restrictedReason?: string | null;
  listingGate?: ListingGate | null;
  priceVolatility: number;
  historyDays: number;
  sampleCount: number;
  ageMinutes: number;
  pattern: RiskInput["pattern"];
  /** 90日中央値。値引きの深さを見るために使う（任意） */
  median90?: number | null;
  /** 基準価格（未指定時は median90） */
  referencePrice?: number | null;
  costs: CostSettings;
  thresholds: ThresholdSettings;
  /** 1銘柄に投下してよい上限額（資金配分ルールの結果） */
  perItemCap: number;
}

/**
 * 1件の候補を最後まで評価する。
 * 提案書 3.2節の門番（純利益・利益率・売れるまでの日数・信頼度）をここで通す。
 */
export function evaluate(a: EvaluateArgs): Evaluation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const listingGate = resolveListingGate(a.restricted, a.listingGate);

  // まず暫定の保有日数で保管料を見積もり、利益を出す
  const provisional = calcVelocity({
    salesPerDay: a.salesPerDay,
    offerCount: a.offerCount,
    horizonDays: a.thresholds.maxExpectedDays,
  });
  const holdingDaysForFees = Number.isFinite(provisional.expectedDays)
    ? Math.min(provisional.expectedDays, a.thresholds.forceSellDays)
    : a.thresholds.forceSellDays;

  const profit = calcProfit({
    buyPrice: a.buyPrice,
    expectedSellPrice: a.expectedSellPrice,
    referralFeeRate: a.referralFeeRate,
    sizeTier: a.sizeTier,
    holdingDays: holdingDaysForFees,
    costs: a.costs,
  });

  const confidence = calcConfidence({
    historyDays: a.historyDays,
    sampleCount: a.sampleCount,
    ageMinutes: a.ageMinutes,
  });
  const riskFactor = calcRiskFactor({
    restricted: a.restricted,
    listingGate,
    priceVolatility: a.priceVolatility,
    offerCount: a.offerCount,
    pattern: a.pattern,
  });

  const stopLoss = profit.acquisitionCost * Math.abs(a.thresholds.stopLossRate);
  const expProfit = expectedProfit(profit.netProfit, provisional.sellProbability, stopLoss);
  const rann = annualizedReturn(expProfit, profit.acquisitionCost, provisional.expectedDays);
  const score = Math.max(0, rann) * confidence * riskFactor;

  const maxBuyPrice = calcMaxBuyPrice({
    expectedSellPrice: a.expectedSellPrice,
    referralFeeRate: a.referralFeeRate,
    sizeTier: a.sizeTier,
    holdingDays: holdingDaysForFees,
    costs: a.costs,
    minNetProfit: a.thresholds.minNetProfit,
    minRoi: a.thresholds.minRoi,
  });

  const referencePrice = a.referencePrice ?? a.median90 ?? null;
  const discountRate =
    referencePrice && referencePrice > 0 ? 1 - a.buyPrice / referencePrice : null;

  // ---- 門番（提案書 3.2節）------------------------------------------
  if (listingGate === "FAIL") {
    reasons.push(`出品ゲート FAIL${a.restrictedReason ? `（${a.restrictedReason}）` : ""}`);
  } else if (listingGate === "UNKNOWN") {
    reasons.push("出品ゲート UNKNOWN（証憑・制限未確認）。推奨数は0");
  }
  if (profit.netProfit < a.thresholds.minNetProfit) {
    reasons.push(`純利益 ${Math.round(profit.netProfit)}円 < 下限 ${a.thresholds.minNetProfit}円`);
  }
  if (profit.roi < a.thresholds.minRoi) {
    reasons.push(`利益率 ${(profit.roi * 100).toFixed(1)}% < 下限 ${(a.thresholds.minRoi * 100).toFixed(0)}%`);
  }
  if (!(provisional.expectedDays <= a.thresholds.maxExpectedDays)) {
    const d = Number.isFinite(provisional.expectedDays) ? provisional.expectedDays.toFixed(0) : "∞";
    reasons.push(`売れるまで ${d}日 > 上限 ${a.thresholds.maxExpectedDays}日`);
  }
  if (confidence < a.thresholds.minConfidence) {
    reasons.push(`データ信頼度 ${confidence.toFixed(2)} < 下限 ${a.thresholds.minConfidence}`);
  }
  if (a.restricted && listingGate !== "FAIL") {
    reasons.push(`出品制限・要確認カテゴリ${a.restrictedReason ? `（${a.restrictedReason}）` : ""}`);
  }
  if (expProfit <= 0) {
    reasons.push(`期待純利益が ${Math.round(expProfit)}円（損切り込みでマイナス）`);
  }
  if (a.buyPrice > maxBuyPrice && maxBuyPrice > 0) {
    reasons.push(`仕入価格 ${Math.round(a.buyPrice)}円 > 仕入上限 ${maxBuyPrice}円`);
  }

  // ---- 警告（通知はするが注意を促す）---------------------------------
  if (a.priceVolatility > 0.25) warnings.push("値動きが大きい商品です");
  if (a.offerCount > 15) warnings.push(`競合が多い（${a.offerCount}社）`);
  if (a.historyDays < 30) warnings.push("価格履歴が30日未満です");
  if (a.median90 && a.expectedSellPrice > a.median90 * 1.05) {
    warnings.push("想定販売価格が90日中央値を上回っています");
  }
  if (profit.storageFee > profit.netProfit * a.thresholds.storageRatioCap) {
    warnings.push("保管料が利益を圧迫します（早めの回転が必要）");
  }

  // ---- 数量（資金配分の上限内に収める。ゲート未通過は0）-------------
  let suggestedQty =
    profit.acquisitionCost > 0 ? Math.max(0, Math.floor(a.perItemCap / profit.acquisitionCost)) : 0;
  if (listingGate !== "PASS") suggestedQty = 0;
  if (suggestedQty < 1 && listingGate === "PASS") {
    reasons.push("1個あたりの原価が資金配分の上限を超えています");
  }

  const passed = reasons.length === 0;
  const judgment = classifyJudgment({
    passed,
    confidence,
    suggestedQty,
    listingGate,
    historyDays: a.historyDays,
  });

  return {
    ...profit,
    salesPerDay: a.salesPerDay,
    offerCount: a.offerCount,
    expectedDays: Number.isFinite(provisional.expectedDays) ? provisional.expectedDays : 9999,
    sellProbability: provisional.sellProbability,
    expectedProfit: expProfit,
    annualizedReturn: rann,
    confidence,
    riskFactor,
    score,
    suggestedQty: Math.max(0, suggestedQty),
    maxBuyPrice,
    referencePrice,
    discountRate,
    listingGate,
    judgment,
    passed,
    reasons,
    warnings,
  };
}
