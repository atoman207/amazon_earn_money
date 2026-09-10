import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { allocate } from "@/lib/domain/allocation";
import { evaluate } from "@/lib/domain/profit";
import type { AppSettings, Pattern } from "@/lib/domain/types";
import type { OpportunityRow, PriceObservationRow, ProductRow } from "@/lib/supabase/database.types";

export interface ObservationInput {
  asin: string;
  buyPrice?: number | null;
  sellPrice?: number | null;
  offerCount?: number | null;
  salesRank?: number | null;
  inStock?: boolean;
  source?: string;
  observedAt?: string;
}

/** 中央値・標準偏差など、履歴からその商品の「ふだんの姿」を出す */
export interface PriceHistoryStats {
  count: number;
  historyDays: number;
  median30: number | null;
  median90: number | null;
  median180: number | null;
  median365: number | null;
  min90: number | null;
  volatility: number; // 標準偏差 / 平均
  salesPerDay: number; // μ
  lastObservedAt: string | null;
  baselineOfferCount: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * ランキングが改善した回数を「売れた回数」の代理指標として数え、
 * 観測期間で割って μ（1日あたり販売数）を推定する。
 */
export function estimateSalesPerDay(obs: Pick<PriceObservationRow, "observed_at" | "sales_rank">[]): number {
  const ranked = obs
    .filter((o) => typeof o.sales_rank === "number" && o.sales_rank! > 0)
    .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());
  if (ranked.length < 2) return 0;

  let drops = 0;
  for (let i = 1; i < ranked.length; i++) {
    const prev = ranked[i - 1].sales_rank!;
    const cur = ranked[i].sales_rank!;
    // 順位が 10% 以上改善したら 1件売れたとみなす
    if (cur < prev * 0.9) drops++;
  }
  const spanMs =
    new Date(ranked[ranked.length - 1].observed_at).getTime() - new Date(ranked[0].observed_at).getTime();
  const spanDays = Math.max(spanMs / 86_400_000, 1 / 24);
  return drops / spanDays;
}

export function summarizeHistory(obs: PriceObservationRow[]): PriceHistoryStats {
  if (!obs.length) {
    return {
      count: 0,
      historyDays: 0,
      median30: null,
      median90: null,
      median180: null,
      median365: null,
      min90: null,
      volatility: 0,
      salesPerDay: 0,
      lastObservedAt: null,
      baselineOfferCount: 1,
    };
  }

  const sorted = [...obs].sort(
    (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime(),
  );
  const now = new Date(sorted[sorted.length - 1].observed_at).getTime();
  const pricesInWindow = (days: number) => {
    const since = now - days * 86_400_000;
    return sorted
      .filter((o) => new Date(o.observed_at).getTime() >= since)
      .map((o) => o.sell_price)
      .filter((p): p is number => typeof p === "number" && p > 0);
  };

  const prices90 = pricesInWindow(90);
  const allPrices = sorted.map((o) => o.sell_price).filter((p): p is number => typeof p === "number" && p > 0);

  const mean = allPrices.length ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : 0;
  const variance = allPrices.length
    ? allPrices.reduce((a, b) => a + (b - mean) ** 2, 0) / allPrices.length
    : 0;
  const volatility = mean > 0 ? Math.sqrt(variance) / mean : 0;

  const spanDays =
    (new Date(sorted[sorted.length - 1].observed_at).getTime() -
      new Date(sorted[0].observed_at).getTime()) /
    86_400_000;

  const offers = sorted
    .map((o) => o.offer_count)
    .filter((n): n is number => typeof n === "number" && n > 0);

  return {
    count: sorted.length,
    historyDays: Math.max(0, spanDays),
    median30: median(pricesInWindow(30)),
    median90: median(prices90),
    median180: median(pricesInWindow(180)),
    median365: median(pricesInWindow(365)),
    min90: prices90.length ? Math.min(...prices90) : null,
    volatility,
    salesPerDay: estimateSalesPerDay(sorted),
    lastObservedAt: sorted[sorted.length - 1].observed_at,
    baselineOfferCount: Math.max(1, Math.round(median(offers) ?? 1)),
  };
}

/** 値引きの種類を推定する（底値・OOS優先、急落は補助タグ） */
export function classifyPattern(buyPrice: number, median90: number | null, offerCount: number): Pattern {
  if (!median90 || median90 <= 0) return "timesale";
  const discount = 1 - buyPrice / median90;
  if (offerCount <= 1 && discount >= 0.05) return "oos";
  if (discount >= 0.25) return "bottom";
  if (discount >= 0.15) return "timesale";
  if (offerCount <= 3) return "demand";
  return "business";
}

export interface DetectResult {
  asin: string;
  created: boolean;
  reason?: string;
  opportunityId?: string;
  netProfit?: number;
  score?: number;
  passed?: boolean;
}

/** すでに投下している資金を数える（資金配分の上限判定に使う） */
async function deployedCapital(category: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("positions")
    .select("qty, acquisition_cost, asin, products(category)")
    .in("status", ["holding", "listed"]);

  let total = 0;
  let inCategory = 0;
  for (const p of (data ?? []) as unknown as Array<{
    qty: number;
    acquisition_cost: number;
    products: { category: string } | null;
  }>) {
    const amount = p.qty * p.acquisition_cost;
    total += amount;
    if (p.products?.category === category) inCategory += amount;
  }
  return { total, inCategory };
}

/**
 * 1商品ぶんの観測を取り込み、値引きを検知したら利益を計算して機会として登録する。
 * 提案書 3.1〜3.2節（見つける → 利益を計算する）にあたる処理。
 */
export async function ingestAndEvaluate(
  input: ObservationInput,
  settings: AppSettings,
): Promise<DetectResult> {
  const db = supabaseAdmin();
  const observedAt = input.observedAt ?? new Date().toISOString();

  const { data: product, error: pErr } = await db
    .from("products")
    .select("*")
    .eq("asin", input.asin)
    .maybeSingle();

  if (pErr) return { asin: input.asin, created: false, reason: `商品の取得に失敗: ${pErr.message}` };
  if (!product) return { asin: input.asin, created: false, reason: "商品マスタに未登録" };

  // 観測を追記（履歴は決して書き換えない）
  const { error: oErr } = await db.from("price_observations").insert({
    asin: input.asin,
    observed_at: observedAt,
    buy_price: input.buyPrice ?? null,
    sell_price: input.sellPrice ?? null,
    offer_count: input.offerCount ?? null,
    sales_rank: input.salesRank ?? null,
    in_stock: input.inStock ?? true,
    source: input.source ?? "manual",
  });
  if (oErr) return { asin: input.asin, created: false, reason: `観測の保存に失敗: ${oErr.message}` };

  await db
    .from("watch_universe")
    .update({ last_checked_at: observedAt })
    .eq("asin", input.asin);

  if (input.inStock === false) return { asin: input.asin, created: false, reason: "在庫なし" };
  if (!input.buyPrice || !input.sellPrice) {
    return { asin: input.asin, created: false, reason: "価格が取得できていない" };
  }

  // 直近365日の履歴から、その商品のふだんの姿を出す（30/90/180/365 窓）
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: history } = await db
    .from("price_observations")
    .select("*")
    .eq("asin", input.asin)
    .gte("observed_at", since)
    .order("observed_at", { ascending: true })
    .limit(8000);

  const stats = summarizeHistory((history ?? []) as PriceObservationRow[]);
  const offerCount = input.offerCount ?? stats.baselineOfferCount;
  const pattern = classifyPattern(input.buyPrice, stats.median90, offerCount);
  // 基準価格は判断時点より前の比較可能系列の中央値（90日優先、なければ180/365）
  const referencePrice = stats.median90 ?? stats.median180 ?? stats.median365;

  // 同じ商品を短時間に何度も通知しない（提案書 3.3節の重複抑制）
  const dedupeSince = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: recent } = await db
    .from("opportunities")
    .select("id")
    .eq("asin", input.asin)
    .gte("detected_at", dedupeSince)
    .in("status", ["pending", "approved", "ordered"])
    .limit(1);
  if (recent && recent.length) {
    return { asin: input.asin, created: false, reason: "24時間以内に検知済み" };
  }

  // 資金配分の上限を先に決めてから評価する
  const deployed = await deployedCapital(product.category);
  const rough = Math.max(1, input.sellPrice - input.buyPrice);
  const alloc = allocate({
    capital: settings.capital,
    deployedTotal: deployed.total,
    deployedInCategory: deployed.inCategory,
    netProfit: rough,
    stopLoss: input.buyPrice * Math.abs(settings.thresholds.stopLossRate),
    sellProbability: 0.7,
  });

  const ageMinutes = stats.lastObservedAt
    ? Math.max(0, (Date.now() - new Date(stats.lastObservedAt).getTime()) / 60_000)
    : 0;

  const ev = evaluate({
    buyPrice: input.buyPrice,
    expectedSellPrice: referencePrice ?? input.sellPrice,
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
    pattern,
    median90: stats.median90,
    referencePrice,
    costs: settings.costs,
    thresholds: settings.thresholds,
    perItemCap: alloc.perItemCap,
  });

  // 通過しなかった候補も記録に残す（あとで閾値を検証できるようにするため）
  const row = {
    asin: input.asin,
    detected_at: observedAt,
    buy_price: input.buyPrice,
    expected_sell_price: ev.expectedSellPrice,
    referral_fee: ev.referralFee,
    fba_fee: ev.fbaFee,
    storage_fee: ev.storageFee,
    returns_allowance: ev.returnsAllowance,
    inbound_cost: ev.inboundCost,
    points_back: ev.pointsBack,
    acquisition_cost: ev.acquisitionCost,
    net_proceeds: ev.netProceeds,
    net_profit: ev.netProfit,
    roi: ev.roi,
    sales_per_day: ev.salesPerDay,
    offer_count: ev.offerCount,
    expected_days: Math.min(ev.expectedDays, 9999),
    sell_probability: ev.sellProbability,
    expected_profit: ev.expectedProfit,
    annualized_return: ev.annualizedReturn,
    confidence: ev.confidence,
    risk_factor: ev.riskFactor,
    score: ev.score,
    suggested_qty: ev.suggestedQty,
    pattern,
    reasons: ev.reasons as never,
    warnings: ev.warnings as never,
    passed: ev.passed,
    status: ev.passed ? "pending" : "expired",
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    max_buy_price: ev.maxBuyPrice,
    reference_price: ev.referencePrice,
    discount_rate: ev.discountRate,
    listing_gate: ev.listingGate,
    judgment: ev.judgment,
  };

  const { data: inserted, error: iErr } = await db
    .from("opportunities")
    .insert(row as never)
    .select("id")
    .single();

  if (iErr && /max_buy_price|reference_price|discount_rate|listing_gate|judgment|column/i.test(iErr.message)) {
    const {
      max_buy_price: _m,
      reference_price: _r,
      discount_rate: _d,
      listing_gate: _g,
      judgment: _j,
      ...legacy
    } = row;
    const retry = await db.from("opportunities").insert(legacy as never).select("id").single();
    if (retry.error) {
      return { asin: input.asin, created: false, reason: `機会の保存に失敗: ${retry.error.message}` };
    }
    return {
      asin: input.asin,
      created: true,
      opportunityId: (retry.data as { id: string }).id,
      netProfit: ev.netProfit,
      score: ev.score,
      passed: ev.passed,
    };
  }

  if (iErr) return { asin: input.asin, created: false, reason: `機会の保存に失敗: ${iErr.message}` };

  // 監視中なら仕入上限を同期（カラムがある場合のみ）
  if (ev.passed && ev.maxBuyPrice > 0) {
    await db
      .from("watch_universe")
      .update({ max_buy_price: ev.maxBuyPrice } as never)
      .eq("asin", input.asin);
  }

  return {
    asin: input.asin,
    created: true,
    opportunityId: (inserted as { id: string }).id,
    netProfit: ev.netProfit,
    score: ev.score,
    passed: ev.passed,
  };
}

export type OpportunityWithProduct = OpportunityRow & { products: ProductRow | null };
