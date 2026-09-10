import "server-only";
import { summarizeHistory, type PriceHistoryStats } from "@/lib/server/pipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  PriceObservationRow,
  ProductRow,
  WatchRow,
} from "@/lib/supabase/database.types";

/**
 * 商品1件ぶんの「いまの姿」をまとめたもの。
 *
 * ②商品分析・③バックテスト・⑦リスク管理はどれも同じ材料
 * （商品マスタ・監視の状態・価格の履歴・いまの価格）を必要とするので、
 * 取得はここに一本化する。1商品ずつ問い合わせると件数ぶん往復が増えるため、
 * 観測はまとめて1回で取り、JS側で ASIN ごとに束ねる。
 */

export interface AsinSnapshot {
  asin: string;
  product: ProductRow;
  watch: WatchRow | null;
  /** 履歴から出したふだんの姿（中央値・変動・売れ行きなど） */
  stats: PriceHistoryStats;
  /** いちばん新しい観測 */
  latest: PriceObservationRow | null;
  /** 日次に間引いた市場価格。グラフと予測に使う */
  daily: Array<{ date: string; price: number }>;
  /** 期間内の観測件数 */
  observationCount: number;
  /** 直近の販売ランキング */
  latestRank: number | null;
  /** ランキングの傾き（負なら売れている） */
  rankTrend: number;
  /** 7日前と比べた競合数の増減 */
  offerDelta: number | null;
}

export interface UniverseOptions {
  /** 対象にする商品数の上限 */
  limit?: number;
  /** さかのぼる日数 */
  days?: number;
  /** 監視リストに入っているものだけに絞る */
  watchedOnly?: boolean;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * ランキングの傾き。直近14件の最初と最後を比べ、値が小さくなっていれば
 * 売れている（負の値）とみなす。件数が足りなければ 0（判断しない）。
 */
function rankTrendOf(rows: PriceObservationRow[]): number {
  const ranks = rows
    .slice(-14)
    .map((r) => r.sales_rank)
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (ranks.length < 2) return 0;
  return (ranks[ranks.length - 1] - ranks[0]) / Math.max(1, ranks[0]);
}

/** 7日前と比べた競合数の増減。比較できる観測が無ければ null。 */
function offerDeltaOf(rows: PriceObservationRow[]): number | null {
  const withOffers = rows.filter((r) => typeof r.offer_count === "number");
  if (!withOffers.length) return null;
  const last = withOffers[withOffers.length - 1].offer_count as number;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const older = [...withOffers].reverse().find((r) => new Date(r.observed_at).getTime() <= weekAgo);
  return older ? last - (older.offer_count as number) : null;
}

/** 市場価格を日ごとの中央値に間引く（1日に何度も観測が入るため） */
function toDaily(rows: PriceObservationRow[]): Array<{ date: string; price: number }> {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    if (typeof r.sell_price !== "number" || !(r.sell_price > 0)) continue;
    const day = r.observed_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(r.sell_price);
  }
  return [...byDay.entries()]
    .map(([date, prices]) => ({ date, price: Math.round(median(prices) ?? 0) }))
    .filter((d) => d.price > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 商品と価格履歴をまとめて読む。
 * 観測が1件も無い商品も返す（「データが無い」ことも判断材料なので落とさない）。
 */
export async function loadUniverse(options: UniverseOptions = {}): Promise<AsinSnapshot[]> {
  const limit = options.limit ?? 120;
  const days = options.days ?? 365;
  const db = supabaseAdmin();

  const [{ data: products }, { data: watches }] = await Promise.all([
    db.from("products").select("*").order("created_at", { ascending: false }).limit(limit),
    db.from("watch_universe").select("*").limit(1000),
  ]);

  const watchByAsin = new Map(
    ((watches as WatchRow[] | null) ?? []).map((w) => [w.asin, w]),
  );

  let rows = (products as ProductRow[] | null) ?? [];
  if (options.watchedOnly) rows = rows.filter((p) => watchByAsin.get(p.asin)?.active);
  if (rows.length === 0) return [];

  const asins = rows.map((p) => p.asin);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // 1回のクエリで取り切れる件数には上限があるので、ASIN を分けて取る
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += 40) chunks.push(asins.slice(i, i + 40));

  const observations = new Map<string, PriceObservationRow[]>();
  for (const chunk of chunks) {
    const { data } = await db
      .from("price_observations")
      .select("*")
      .in("asin", chunk)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(20000);
    for (const o of (data as PriceObservationRow[] | null) ?? []) {
      if (!observations.has(o.asin)) observations.set(o.asin, []);
      observations.get(o.asin)!.push(o);
    }
  }

  return rows.map((product) => {
    const obs = observations.get(product.asin) ?? [];
    return {
      asin: product.asin,
      product,
      watch: watchByAsin.get(product.asin) ?? null,
      stats: summarizeHistory(obs),
      latest: obs.length ? obs[obs.length - 1] : null,
      daily: toDaily(obs),
      observationCount: obs.length,
      latestRank: obs.length ? (obs[obs.length - 1].sales_rank ?? null) : null,
      rankTrend: rankTrendOf(obs),
      offerDelta: offerDeltaOf(obs),
    };
  });
}

/** 1商品ぶんだけ読む（商品ページや通知カードで使う） */
export async function loadAsin(asin: string, days = 365): Promise<AsinSnapshot | null> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [{ data: product }, { data: watch }, { data: obs }] = await Promise.all([
    db.from("products").select("*").eq("asin", asin).maybeSingle(),
    db.from("watch_universe").select("*").eq("asin", asin).maybeSingle(),
    db
      .from("price_observations")
      .select("*")
      .eq("asin", asin)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(8000),
  ]);

  if (!product) return null;
  const rows = (obs as PriceObservationRow[] | null) ?? [];

  return {
    asin,
    product: product as ProductRow,
    watch: (watch as WatchRow | null) ?? null,
    stats: summarizeHistory(rows),
    latest: rows.length ? rows[rows.length - 1] : null,
    daily: toDaily(rows),
    observationCount: rows.length,
    latestRank: rows.length ? (rows[rows.length - 1].sales_rank ?? null) : null,
    rankTrend: rankTrendOf(rows),
    offerDelta: offerDeltaOf(rows),
  };
}

/** 現在の仕入価格。いちばん新しい観測の buy_price を採る。 */
export const currentBuyPrice = (s: AsinSnapshot) =>
  typeof s.latest?.buy_price === "number" ? s.latest.buy_price : null;

/** 現在の市場価格 */
export const currentSellPrice = (s: AsinSnapshot) =>
  typeof s.latest?.sell_price === "number" ? s.latest.sell_price : null;

/** 基準価格（90日中央値を優先し、無ければ180/365日） */
export const referencePrice = (s: AsinSnapshot) =>
  s.stats.median90 ?? s.stats.median180 ?? s.stats.median365;
