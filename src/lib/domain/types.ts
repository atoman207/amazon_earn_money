/** 提案書 3.2節「利益を計算する」/ 8節の各パラメータに対応する型定義 */

export type SizeTier = "small" | "standard" | "large" | "oversize";
export type PurchaseMode = "A" | "B" | "C";
export type Pattern = "timesale" | "business" | "demand" | "oos" | "bottom";
/** 出品・証憑ゲート（FAIL/UNKNOWN は購入不可） */
export type ListingGate = "PASS" | "FAIL" | "UNKNOWN";
/** 候補の判定ラベル */
export type Judgment = "buy" | "pilot" | "review" | "skip";
export type WatchStatus = "candidate" | "review" | "watching" | "paused" | "ended";
export type SkipReasonCode =
  | "price_change"
  | "profit_low"
  | "competition"
  | "evidence_weak"
  | "restriction"
  | "capital"
  | "mismatch"
  | "other";

/** settings.costs */
export interface CostSettings {
  /** 入庫費用（納品送料・資材・作業）1個あたり円 */
  inboundCostPerUnit: number;
  /** ポイント還元率（仕入価格に対する比率） */
  pointsBackRate: number;
  /** 返品・値下げ引当（販売価格に対する比率） */
  returnsRate: number;
  /** 在庫保管料 1日あたり円 */
  storageFeePerDay: number;
  /** 配送代行手数料（サイズ区分別・円） */
  fbaFeeByTier: Record<SizeTier, number>;
}

/** settings.thresholds — 通知するかどうかの門番 */
export interface ThresholdSettings {
  /** 最低純利益（円） */
  minNetProfit: number;
  /** 最低利益率 */
  minRoi: number;
  /** 期待保有日数の上限 */
  maxExpectedDays: number;
  /** データ信頼度 κ の下限 */
  minConfidence: number;
  /** 価格損切りライン（原価比・負値） 例 -0.10 */
  stopLossRate: number;
  /** 時間損切り（日） */
  timeStopDays: number;
  /** 成行売却（日） */
  forceSellDays: number;
  /** トレーリング利確の下落率 δ */
  trailingDrop: number;
  /** 累計保管費 / 期待利益 の上限 */
  storageRatioCap: number;
}

/** settings.capital — 資金配分 */
export interface CapitalSettings {
  workingCapital: number;
  kellyFraction: number;
  maxPerItemRatio: number;
  maxPerCategoryRatio: number;
  cashReserveRatio: number;
}

/** settings.notify */
export interface NotifySettings {
  intervalMinutes: number;
  topN: number;
  dailyLimit: number;
  quietStartHour: number;
  quietEndHour: number;
  urgentEnabled: boolean;
}

/** settings.operation */
export interface OperationSettings {
  purchaseMode: PurchaseMode;
  autoModeEnabled: boolean;
}

export interface AppSettings {
  costs: CostSettings;
  thresholds: ThresholdSettings;
  capital: CapitalSettings;
  notify: NotifySettings;
  operation: OperationSettings;
}

/** 利益計算の入力 */
export interface ProfitInput {
  /** Pb 仕入価格（税込） */
  buyPrice: number;
  /** Ps 想定販売価格（税込） */
  expectedSellPrice: number;
  /** fr 販売手数料率（カテゴリ別） */
  referralFeeRate: number;
  /** 配送代行手数料のサイズ区分 */
  sizeTier: SizeTier;
  /** h 想定保有日数（保管料の算定に使う） */
  holdingDays: number;
  costs: CostSettings;
}

/** 利益計算の結果（提案書 3.2節の表と1対1で対応） */
export interface ProfitBreakdown {
  expectedSellPrice: number;
  referralFee: number;
  fbaFee: number;
  storageFee: number;
  returnsAllowance: number;
  /** Ns 手取り額 */
  netProceeds: number;
  buyPrice: number;
  pointsBack: number;
  inboundCost: number;
  /** Ca 実質取得原価 */
  acquisitionCost: number;
  /** π 純利益 */
  netProfit: number;
  /** ROI = π / Ca */
  roi: number;
}

/** 売れ行きの推定 */
export interface VelocityInput {
  /** μ 1日あたり推定販売数 */
  salesPerDay: number;
  /** n 競合出品者数 */
  offerCount: number;
  /** 評価する日数 */
  horizonDays: number;
}

export interface VelocityResult {
  /** E[h] 期待保有日数 */
  expectedDays: number;
  /** ps 期間内に売れる確率 */
  sellProbability: number;
}

/** 信頼度 κ の材料 */
export interface ConfidenceInput {
  /** 価格履歴の日数 */
  historyDays: number;
  /** 観測件数 */
  sampleCount: number;
  /** 最終観測からの経過分 */
  ageMinutes: number;
}

/** リスク係数 φ の材料 */
export interface RiskInput {
  restricted: boolean;
  listingGate?: ListingGate;
  /** 価格の変動係数（標準偏差 / 平均） */
  priceVolatility: number;
  offerCount: number;
  pattern: Pattern;
}

export interface Evaluation extends ProfitBreakdown {
  salesPerDay: number;
  offerCount: number;
  expectedDays: number;
  sellProbability: number;
  /** E[π] 期待純利益 */
  expectedProfit: number;
  /** Rann 年率換算収益率 */
  annualizedReturn: number;
  /** κ */
  confidence: number;
  /** φ */
  riskFactor: number;
  /** S 総合スコア */
  score: number;
  suggestedQty: number;
  /** 仕入上限価格（必要利益・ROIを満たす最大仕入額） */
  maxBuyPrice: number;
  /** 比較用基準価格（時間加重中央値の近似） */
  referencePrice: number | null;
  /** 下落率 = 1 − 仕入総額/基準価格 */
  discountRate: number | null;
  listingGate: ListingGate;
  judgment: Judgment;
  passed: boolean;
  reasons: string[];
  warnings: string[];
}
