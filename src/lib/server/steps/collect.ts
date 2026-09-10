import "server-only";
import { getSessionStatus } from "@/lib/server/amazon/session";
import { collectorStatuses, keepaStatus, type CollectorStatus } from "@/lib/server/collector";
import { latestScan, listScanSummaries } from "@/lib/server/discountScan";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  DiscountProductRow,
  DiscountScanRow,
  DiscountScanSummary,
  PriceObservationRow,
  ProductRow,
} from "@/lib/supabase/database.types";

/**
 * ① データ収集の材料。
 *
 * この工程で見たいのは商品そのものではなく「取れているかどうか」で、
 * どの項目が何件埋まっているか（＝欠測がどこにあるか）を必ず出す。
 * 下流の②③はここで取れた分しか判断できないので、
 * 取れていないことを隠さないのがこの画面の役目。
 */

/* ------------------------------------------------------------------ */
/* 1-1 Amazon（商品情報・在庫・価格・ランキング・手数料）              */
/* ------------------------------------------------------------------ */

export interface FieldCoverage {
  label: string;
  filled: number;
  total: number;
  /** 取れていないときに何ができなくなるか */
  impact: string;
}

export interface AmazonCollectSnapshot {
  session: {
    exists: boolean;
    loggedIn: boolean | null;
    isBusiness: boolean | null;
    accountLabel: string | null;
    savedAt: string | null;
  };
  scan: DiscountScanRow | null;
  history: DiscountScanSummary[];
  productCount: number;
  coverage: FieldCoverage[];
  /** 商品マスタ側の件数と手数料率の設定状況 */
  master: {
    products: number;
    withFeeRate: number;
    withSizeTier: number;
    categories: number;
  };
  recent: DiscountProductRow[];
}

export async function amazonCollectSnapshot(): Promise<AmazonCollectSnapshot> {
  const db = supabaseAdmin();
  const scan = await latestScan();
  const session = await getSessionStatus().catch(() => null);
  const history = await listScanSummaries(10);

  let products: DiscountProductRow[] = [];
  if (scan) {
    const { data } = await db
      .from("discount_products")
      .select("*")
      .eq("scan_id", scan.id)
      .order("discount_rate", { ascending: false, nullsFirst: false })
      .limit(400);
    products = (data as DiscountProductRow[] | null) ?? [];
  }

  const { data: masterRows } = await db
    .from("products")
    .select("asin, category, referral_fee_rate, size_tier")
    .limit(2000);
  const master =
    (masterRows as Array<Pick<ProductRow, "asin" | "category" | "referral_fee_rate" | "size_tier">> | null) ?? [];

  const filled = (fn: (p: DiscountProductRow) => unknown) =>
    products.filter((p) => {
      const v = fn(p);
      return v !== null && v !== undefined && v !== "";
    }).length;

  const coverage: FieldCoverage[] = [
    { label: "商品名・ASIN", filled: filled((p) => p.name), total: products.length, impact: "商品を特定できません" },
    {
      label: "ビジネス価格（仕入価格）",
      filled: filled((p) => p.unit_price),
      total: products.length,
      impact: "利益計算そのものができません",
    },
    {
      label: "参考価格（比較の基準）",
      filled: filled((p) => p.reference_price),
      total: products.length,
      impact: "価格差を出せません",
    },
    {
      label: "割引率・割引額",
      filled: filled((p) => p.discount_rate),
      total: products.length,
      impact: "値引きの深さで並べ替えられません",
    },
    {
      label: "商品画像",
      filled: filled((p) => p.image_url),
      total: products.length,
      impact: "通知カードに画像が出ません",
    },
    {
      label: "在庫（数量表示）",
      filled: filled((p) => p.quantity),
      total: products.length,
      impact: "まとめ買いの可否が分かりません",
    },
  ];

  return {
    session: {
      exists: session?.exists ?? false,
      loggedIn: session?.loggedIn ?? null,
      isBusiness: session?.isBusiness ?? session?.isBusinessFromFile ?? null,
      accountLabel: session?.accountLabel ?? null,
      savedAt: session?.savedFileAt ?? null,
    },
    scan,
    history,
    productCount: products.length,
    coverage,
    master: {
      products: master.length,
      withFeeRate: master.filter((m) => Number(m.referral_fee_rate) > 0).length,
      withSizeTier: master.filter((m) => Boolean(m.size_tier)).length,
      categories: new Set(master.map((m) => m.category)).size,
    },
    recent: products.slice(0, 12),
  };
}

/* ------------------------------------------------------------------ */
/* 1-2 Keepa（価格推移・売れ行き・在庫履歴）                            */
/* ------------------------------------------------------------------ */

export interface KeepaCollectSnapshot {
  status: CollectorStatus;
  collectors: CollectorStatus[];
  watched: number;
  /** 期間ごとの観測件数 */
  observations: { day: number; week: number; month: number; total: number };
  /** 直近14日の日次件数 */
  daily: Array<{ date: string; count: number }>;
  /** どこから入った観測か */
  sources: Array<{ source: string; count: number }>;
  /** 24時間以内に取れている監視銘柄の割合 */
  freshRatio: number | null;
  /** しばらく取れていない銘柄 */
  stale: Array<{ asin: string; title: string; lastCheckedAt: string | null }>;
  /** 履歴の長さ（判定の信頼度に直結する） */
  historyDays: Array<{ asin: string; title: string; days: number; count: number }>;
}

export async function keepaCollectSnapshot(): Promise<KeepaCollectSnapshot> {
  const db = supabaseAdmin();
  const now = Date.now();
  const iso = (ms: number) => new Date(now - ms).toISOString();

  const [{ data: watchRows }, { count: total }, { count: day }, { count: week }, { count: month }] =
    await Promise.all([
      db.from("watch_universe").select("asin, last_checked_at, active").eq("active", true).limit(500),
      db.from("price_observations").select("id", { count: "exact", head: true }),
      db.from("price_observations").select("id", { count: "exact", head: true }).gte("observed_at", iso(86_400_000)),
      db
        .from("price_observations")
        .select("id", { count: "exact", head: true })
        .gte("observed_at", iso(7 * 86_400_000)),
      db
        .from("price_observations")
        .select("id", { count: "exact", head: true })
        .gte("observed_at", iso(30 * 86_400_000)),
    ]);

  const watches = (watchRows as Array<{ asin: string; last_checked_at: string | null }> | null) ?? [];

  const { data: recentRows } = await db
    .from("price_observations")
    .select("asin, observed_at, source")
    .gte("observed_at", iso(14 * 86_400_000))
    .order("observed_at", { ascending: false })
    .limit(20000);
  const recent =
    (recentRows as Array<Pick<PriceObservationRow, "asin" | "observed_at" | "source">> | null) ?? [];

  const byDay = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const r of recent) {
    const d = r.observed_at.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  }

  const daily: Array<{ date: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    daily.push({ date, count: byDay.get(date) ?? 0 });
  }

  const dayAgo = now - 86_400_000;
  const fresh = watches.filter(
    (w) => w.last_checked_at && new Date(w.last_checked_at).getTime() >= dayAgo,
  ).length;

  const titles = new Map<string, string>();
  if (watches.length) {
    const { data: products } = await db
      .from("products")
      .select("asin, title")
      .in("asin", watches.slice(0, 200).map((w) => w.asin));
    for (const p of (products as Array<{ asin: string; title: string }> | null) ?? []) {
      titles.set(p.asin, p.title);
    }
  }

  const stale = watches
    .filter((w) => !w.last_checked_at || new Date(w.last_checked_at).getTime() < now - 3 * 86_400_000)
    .slice(0, 12)
    .map((w) => ({ asin: w.asin, title: titles.get(w.asin) ?? w.asin, lastCheckedAt: w.last_checked_at }));

  // 履歴の長さは、その銘柄のいちばん古い観測と新しい観測の差で見る
  const { data: spanRows } = await db
    .from("price_observations")
    .select("asin, observed_at")
    .order("observed_at", { ascending: true })
    .limit(20000);
  const spans = new Map<string, { first: string; last: string; count: number }>();
  for (const r of (spanRows as Array<{ asin: string; observed_at: string }> | null) ?? []) {
    const cur = spans.get(r.asin);
    if (!cur) spans.set(r.asin, { first: r.observed_at, last: r.observed_at, count: 1 });
    else {
      cur.last = r.observed_at;
      cur.count += 1;
    }
  }

  const historyDays = [...spans.entries()]
    .map(([asin, v]) => ({
      asin,
      title: titles.get(asin) ?? asin,
      days: (new Date(v.last).getTime() - new Date(v.first).getTime()) / 86_400_000,
      count: v.count,
    }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 12);

  return {
    status: keepaStatus(),
    collectors: collectorStatuses(),
    watched: watches.length,
    observations: { day: day ?? 0, week: week ?? 0, month: month ?? 0, total: total ?? 0 },
    daily,
    sources: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    freshRatio: watches.length ? fresh / watches.length : null,
    stale,
    historyDays,
  };
}

/* ------------------------------------------------------------------ */
/* 1-3 セラー情報（競合数・出品者情報）                                 */
/* ------------------------------------------------------------------ */

export interface SellerRow {
  asin: string;
  title: string;
  current: number | null;
  /** 7日前の競合数 */
  before: number | null;
  delta: number | null;
  observedAt: string | null;
}

export interface SellerCollectSnapshot {
  rows: SellerRow[];
  buckets: Array<{ label: string; count: number; hint: string }>;
  increasing: SellerRow[];
  /** 競合数が取れていない銘柄の数 */
  missing: number;
  covered: number;
}

export async function sellerCollectSnapshot(limit = 200): Promise<SellerCollectSnapshot> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data: products } = await db.from("products").select("asin, title").limit(limit);
  const list = (products as Array<{ asin: string; title: string }> | null) ?? [];
  if (!list.length) return { rows: [], buckets: [], increasing: [], missing: 0, covered: 0 };

  const { data: obsRows } = await db
    .from("price_observations")
    .select("asin, observed_at, offer_count")
    .gte("observed_at", since)
    .order("observed_at", { ascending: true })
    .limit(20000);

  const byAsin = new Map<string, Array<{ at: string; offers: number }>>();
  for (const o of (obsRows as Array<{ asin: string; observed_at: string; offer_count: number | null }> | null) ?? []) {
    if (typeof o.offer_count !== "number") continue;
    if (!byAsin.has(o.asin)) byAsin.set(o.asin, []);
    byAsin.get(o.asin)!.push({ at: o.observed_at, offers: o.offer_count });
  }

  const weekAgo = Date.now() - 7 * 86_400_000;
  const rows: SellerRow[] = list.map((p) => {
    const series = byAsin.get(p.asin) ?? [];
    if (!series.length) {
      return { asin: p.asin, title: p.title, current: null, before: null, delta: null, observedAt: null };
    }
    const last = series[series.length - 1];
    // 7日より前でいちばん新しいものを比較対象にする
    const older = [...series].reverse().find((s) => new Date(s.at).getTime() <= weekAgo);
    return {
      asin: p.asin,
      title: p.title,
      current: last.offers,
      before: older?.offers ?? null,
      delta: older ? last.offers - older.offers : null,
      observedAt: last.at,
    };
  });

  const covered = rows.filter((r) => r.current !== null).length;
  const bucketOf = (n: number) => (n <= 1 ? 0 : n <= 5 ? 1 : n <= 15 ? 2 : 3);
  const counts = [0, 0, 0, 0];
  for (const r of rows) if (r.current !== null) counts[bucketOf(r.current)] += 1;

  return {
    rows: rows.sort((a, b) => (b.current ?? -1) - (a.current ?? -1)),
    buckets: [
      { label: "1社以下", count: counts[0], hint: "独占。値付けの自由度が高い" },
      { label: "2〜5社", count: counts[1], hint: "狙いやすい水準" },
      { label: "6〜15社", count: counts[2], hint: "回転が落ちる" },
      { label: "16社以上", count: counts[3], hint: "値下げ合戦になりやすい" },
    ],
    increasing: rows
      .filter((r) => (r.delta ?? 0) > 0)
      .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
      .slice(0, 10),
    missing: rows.length - covered,
    covered,
  };
}

/* ------------------------------------------------------------------ */
/* 1-4 その他データ（カテゴリ・レビュー・需要トレンド・季節性）         */
/* ------------------------------------------------------------------ */

export interface CategoryRow {
  category: string;
  products: number;
  avgFeeRate: number;
  restricted: number;
  observed: number;
}

export interface OtherCollectSnapshot {
  categories: CategoryRow[];
  gates: Array<{ label: string; count: number }>;
  /** 月ごとの価格の癖（全銘柄の中央値を1.00としたときの比） */
  seasonality: Array<{ month: number; index: number | null; samples: number }>;
  /** 直近30日でランキングが改善した（売れている）銘柄 */
  demand: Array<{ asin: string; title: string; change: number; latestRank: number }>;
  /** レビューの取得元。未設定なら何ができないかを書く */
  reviews: { available: boolean; note: string };
  sizeTiers: Array<{ tier: string; count: number }>;
}

export async function otherCollectSnapshot(): Promise<OtherCollectSnapshot> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();

  const [{ data: productRows }, { data: obsRows }] = await Promise.all([
    db.from("products").select("*").limit(2000),
    db
      .from("price_observations")
      .select("asin, observed_at, sell_price, sales_rank")
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(20000),
  ]);

  const products = (productRows as ProductRow[] | null) ?? [];
  const obs =
    (obsRows as Array<{
      asin: string;
      observed_at: string;
      sell_price: number | null;
      sales_rank: number | null;
    }> | null) ?? [];

  const observedAsins = new Set(obs.map((o) => o.asin));

  const byCategory = new Map<string, CategoryRow>();
  for (const p of products) {
    const cur =
      byCategory.get(p.category) ??
      ({ category: p.category, products: 0, avgFeeRate: 0, restricted: 0, observed: 0 } as CategoryRow);
    cur.products += 1;
    cur.avgFeeRate += Number(p.referral_fee_rate);
    if (p.restricted) cur.restricted += 1;
    if (observedAsins.has(p.asin)) cur.observed += 1;
    byCategory.set(p.category, cur);
  }
  const categories = [...byCategory.values()]
    .map((c) => ({ ...c, avgFeeRate: c.products ? c.avgFeeRate / c.products : 0 }))
    .sort((a, b) => b.products - a.products);

  const gateCounts = new Map<string, number>();
  for (const p of products) {
    const g = p.listing_gate ?? (p.restricted ? "FAIL" : "PASS");
    gateCounts.set(g, (gateCounts.get(g) ?? 0) + 1);
  }

  const tierCounts = new Map<string, number>();
  for (const p of products) tierCounts.set(p.size_tier, (tierCounts.get(p.size_tier) ?? 0) + 1);

  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // 季節性：月ごとの価格中央値を、全体の中央値で割る
  const allPrices = obs.map((o) => o.sell_price).filter((v): v is number => typeof v === "number" && v > 0);
  const base = median(allPrices);
  const byMonth = new Map<number, number[]>();
  for (const o of obs) {
    if (typeof o.sell_price !== "number" || !(o.sell_price > 0)) continue;
    const m = Number(o.observed_at.slice(5, 7));
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(o.sell_price);
  }
  const seasonality = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const prices = byMonth.get(month) ?? [];
    const m = median(prices);
    return {
      month,
      index: base && base > 0 && m !== null && prices.length >= 3 ? m / base : null,
      samples: prices.length,
    };
  });

  // 需要トレンド：30日前と直近のランキングを比べる（小さいほど売れている）
  const monthAgo = Date.now() - 30 * 86_400_000;
  const rankByAsin = new Map<string, { first: number | null; last: number | null }>();
  for (const o of obs) {
    if (typeof o.sales_rank !== "number" || o.sales_rank <= 0) continue;
    const t = new Date(o.observed_at).getTime();
    const cur = rankByAsin.get(o.asin) ?? { first: null, last: null };
    if (t <= monthAgo) cur.first = o.sales_rank;
    else if (cur.first === null && cur.last === null) cur.first = o.sales_rank;
    cur.last = o.sales_rank;
    rankByAsin.set(o.asin, cur);
  }
  const titleOf = new Map(products.map((p) => [p.asin, p.title]));
  const demand = [...rankByAsin.entries()]
    .filter(([, v]) => v.first && v.last && v.first > 0)
    .map(([asin, v]) => ({
      asin,
      title: titleOf.get(asin) ?? asin,
      change: (v.last! - v.first!) / v.first!,
      latestRank: v.last!,
    }))
    .sort((a, b) => a.change - b.change)
    .slice(0, 12);

  return {
    categories,
    gates: [...gateCounts.entries()].map(([label, count]) => ({ label, count })),
    seasonality,
    demand,
    reviews: {
      available: false,
      note:
        "レビュー（件数・平均評価）の取得元はまだつないでいません。取れるようになると、リスクチェックで「評価が低い・レビューが少なすぎる商品」を外せるようになります。",
    },
    sizeTiers: [...tierCounts.entries()].map(([tier, count]) => ({ tier, count })),
  };
}
