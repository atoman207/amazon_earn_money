import "server-only";
import { allocate } from "@/lib/domain/allocation";
import { forecastPrice, type ForecastResult } from "@/lib/domain/forecast";
import { evaluate } from "@/lib/domain/profit";
import { screenProduct, type ScreenResult } from "@/lib/domain/screen";
import type { AppSettings, Evaluation } from "@/lib/domain/types";
import { classifyPattern } from "@/lib/server/pipeline";
import { loadSettings } from "@/lib/server/settings";
import {
  currentBuyPrice,
  currentSellPrice,
  loadUniverse,
  referencePrice,
  type AsinSnapshot,
} from "@/lib/server/steps/universe";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * ② 商品分析。
 *
 * 1商品につき1回だけ評価し、その結果を5つのサブタブが別の切り口で見せる。
 *   価格差 … 基準価格と今の価格の差
 *   利益   … 手数料を全部引いたあとに残る金額
 *   売れ行き … 何日で売れそうか
 *   競合   … 何社と分け合うか
 *   リスク … 買ってはいけない理由が無いか
 *
 * 判定に使う計算は本番のパイプライン（ingestAndEvaluate）と同じ evaluate() で、
 * 画面用に別の計算を書かない。ここで出る数字と候補の数字がずれてはいけない。
 */

export interface AnalysisRow {
  asin: string;
  title: string;
  category: string;
  imageUrl: string | null;
  /** いま仕入れられる価格 */
  buyPrice: number | null;
  /** いまの市場価格 */
  sellPrice: number | null;
  /** 比較の基準にした価格（90日中央値を優先） */
  reference: number | null;
  /** 基準からの下落率 */
  discountRate: number | null;
  /** 90日の最安値 */
  min90: number | null;
  offerCount: number;
  offerDelta: number | null;
  salesPerDay: number;
  latestRank: number | null;
  rankTrend: number;
  volatility: number;
  historyDays: number;
  observationCount: number;
  pattern: string;
  /** 手数料まで通した評価。材料が足りないときは null */
  evaluation: Evaluation | null;
  /** 評価できなかった理由 */
  skipReason: string | null;
  screen: ScreenResult;
  forecast: ForecastResult | null;
  observedAt: string | null;
}

export interface AnalysisResult {
  rows: AnalysisRow[];
  settings: AppSettings;
  /** 資金配分から出した1銘柄あたりの上限 */
  perItemCap: number;
  deployedTotal: number;
  /** 評価まで進めた件数 */
  evaluated: number;
}

/** すでに投下している資金（資金配分の上限判定に使う） */
async function deployedCapital() {
  const { data } = await supabaseAdmin()
    .from("positions")
    .select("qty, acquisition_cost, products(category)")
    .in("status", ["holding", "listed"]);

  let total = 0;
  const byCategory = new Map<string, number>();
  for (const p of (data ?? []) as unknown as Array<{
    qty: number;
    acquisition_cost: number;
    products: { category: string } | null;
  }>) {
    const amount = p.qty * Number(p.acquisition_cost);
    total += amount;
    const c = p.products?.category ?? "未分類";
    byCategory.set(c, (byCategory.get(c) ?? 0) + amount);
  }
  return { total, byCategory };
}

/** 1商品ぶんを評価する。価格が揃っていないものは理由をつけて返す。 */
export function analyzeSnapshot(
  snapshot: AsinSnapshot,
  settings: AppSettings,
  perItemCap: number,
): AnalysisRow {
  const buyPrice = currentBuyPrice(snapshot);
  const sellPrice = currentSellPrice(snapshot);
  const reference = referencePrice(snapshot);
  const stats = snapshot.stats;
  const offerCount = snapshot.latest?.offer_count ?? stats.baselineOfferCount;
  const product = snapshot.product;

  const forecast = snapshot.daily.length >= 3 ? forecastPrice({ history: snapshot.daily }) : null;

  const screen = screenProduct({
    asin: snapshot.asin,
    title: product.title,
    listingGate: product.listing_gate ?? (product.restricted ? "FAIL" : "PASS"),
    restricted: product.restricted,
    restrictedReason: product.restricted_reason,
    salesPerDay: stats.salesPerDay,
    offerCount,
    volatility: stats.volatility,
    historyDays: stats.historyDays,
    sampleCount: stats.count,
    median90: stats.median90,
    buyPrice,
    forecastChangeRate: forecast?.reliable ? forecast.changeRate : null,
    thresholds: settings.thresholds,
  });

  const base: AnalysisRow = {
    asin: snapshot.asin,
    title: product.title,
    category: product.category,
    imageUrl: product.image_url,
    buyPrice,
    sellPrice,
    reference,
    discountRate: reference && reference > 0 && buyPrice ? 1 - buyPrice / reference : null,
    min90: stats.min90,
    offerCount,
    offerDelta: snapshot.offerDelta,
    salesPerDay: stats.salesPerDay,
    latestRank: snapshot.latestRank,
    rankTrend: snapshot.rankTrend,
    volatility: stats.volatility,
    historyDays: stats.historyDays,
    observationCount: snapshot.observationCount,
    pattern: classifyPattern(buyPrice ?? 0, stats.median90, offerCount),
    evaluation: null,
    skipReason: null,
    screen,
    forecast,
    observedAt: snapshot.latest?.observed_at ?? null,
  };

  if (!buyPrice || !sellPrice) {
    return { ...base, skipReason: "価格の記録がありません（①データ収集が動いていません）" };
  }

  const ageMinutes = stats.lastObservedAt
    ? Math.max(0, (Date.now() - new Date(stats.lastObservedAt).getTime()) / 60_000)
    : 0;

  const evaluation = evaluate({
    buyPrice,
    expectedSellPrice: reference ?? sellPrice,
    referralFeeRate: product.referral_fee_rate,
    sizeTier: product.size_tier,
    salesPerDay: stats.salesPerDay,
    offerCount,
    restricted: product.restricted,
    restrictedReason: product.restricted_reason,
    listingGate: product.listing_gate,
    priceVolatility: stats.volatility,
    historyDays: stats.historyDays,
    sampleCount: stats.count,
    ageMinutes,
    pattern: base.pattern as Parameters<typeof evaluate>[0]["pattern"],
    median90: stats.median90,
    referencePrice: reference,
    costs: settings.costs,
    thresholds: settings.thresholds,
    perItemCap,
  });

  return { ...base, evaluation };
}

/**
 * 商品をまとめて分析する。
 * 並べ替えは「利益の大きい順 → 価格差の大きい順」。評価できないものは後ろに置く。
 */
export async function analyzeUniverse(limit = 120): Promise<AnalysisResult> {
  const [settings, snapshots, deployed] = await Promise.all([
    loadSettings(),
    loadUniverse({ limit }),
    deployedCapital(),
  ]);

  // 上限は「まだ買っていない状態」で見積もる。銘柄ごとの細かい差はカテゴリ枠で吸収する。
  const alloc = allocate({
    capital: settings.capital,
    deployedTotal: deployed.total,
    deployedInCategory: 0,
    netProfit: 1,
    stopLoss: 1,
    sellProbability: 0.7,
  });
  const perItemCap = Math.max(
    alloc.perItemCap,
    settings.capital.workingCapital * settings.capital.maxPerItemRatio,
  );

  const rows = snapshots
    .map((s) => analyzeSnapshot(s, settings, perItemCap))
    .sort((a, b) => {
      const pa = a.evaluation?.netProfit ?? Number.NEGATIVE_INFINITY;
      const pb = b.evaluation?.netProfit ?? Number.NEGATIVE_INFINITY;
      if (pb !== pa) return pb - pa;
      return (b.discountRate ?? -1) - (a.discountRate ?? -1);
    });

  return {
    rows,
    settings,
    perItemCap,
    deployedTotal: deployed.total,
    evaluated: rows.filter((r) => r.evaluation).length,
  };
}
