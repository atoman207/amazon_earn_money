import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { holdingDays } from "@/lib/format";
import type {
  ExitSignalRow,
  OpportunityRow,
  PositionRow,
  PriceObservationRow,
  ProductRow,
  SaleRow,
  WatchRow,
} from "@/lib/supabase/database.types";

export type OpportunityWithProduct = OpportunityRow & { products: ProductRow | null };
export type PositionWithProduct = PositionRow & { products: ProductRow | null };
export type WatchWithProduct = WatchRow & { products: ProductRow | null };

/** 監視ユニバース一覧（R01） */
export async function listWatchUniverse(limit = 200): Promise<WatchWithProduct[]> {
  const { data, error } = await supabaseAdmin()
    .from("watch_universe")
    .select("*, products(*)")
    .order("priority", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as WatchWithProduct[];
}

/** 通知対象になった候補（利益の大きい順） */
export async function listCandidates(limit = 20): Promise<OpportunityWithProduct[]> {
  const { data } = await supabaseAdmin()
    .from("opportunities")
    .select("*, products(*)")
    .eq("status", "pending")
    .eq("passed", true)
    .order("score", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as OpportunityWithProduct[];
}

/** 門番で落ちた候補（なぜ落ちたかを確認できるようにする） */
export async function listRejected(limit = 20): Promise<OpportunityWithProduct[]> {
  const { data } = await supabaseAdmin()
    .from("opportunities")
    .select("*, products(*)")
    .eq("passed", false)
    .order("detected_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as OpportunityWithProduct[];
}

export async function getOpportunity(id: string): Promise<OpportunityWithProduct | null> {
  const { data } = await supabaseAdmin()
    .from("opportunities")
    .select("*, products(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as OpportunityWithProduct) ?? null;
}

export async function listPositions(
  statuses: PositionRow["status"][] = ["holding", "listed"],
): Promise<PositionWithProduct[]> {
  const { data } = await supabaseAdmin()
    .from("positions")
    .select("*, products(*)")
    .in("status", statuses)
    .order("opened_at", { ascending: true });
  return (data ?? []) as unknown as PositionWithProduct[];
}

export async function getPosition(id: string): Promise<PositionWithProduct | null> {
  const { data } = await supabaseAdmin()
    .from("positions")
    .select("*, products(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as PositionWithProduct) ?? null;
}

export async function listOpenSignals(limit = 50): Promise<(ExitSignalRow & { positions: PositionWithProduct | null })[]> {
  const { data } = await supabaseAdmin()
    .from("exit_signals")
    .select("*, positions(*, products(*))")
    .eq("resolved", false)
    .order("fired_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as (ExitSignalRow & { positions: PositionWithProduct | null })[];
}

export async function listSales(limit = 500): Promise<(SaleRow & { products: ProductRow | null })[]> {
  const { data } = await supabaseAdmin()
    .from("sales")
    .select("*, products(*)")
    .order("sold_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as (SaleRow & { products: ProductRow | null })[];
}

/** 商品の価格推移（グラフ用に日次へ間引く） */
export async function priceSeries(asin: string, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabaseAdmin()
    .from("price_observations")
    .select("observed_at, sell_price, buy_price, offer_count, sales_rank")
    .eq("asin", asin)
    .gte("observed_at", since)
    .order("observed_at", { ascending: true })
    .limit(5000);

  const byDay = new Map<string, { sell: number[]; buy: number[]; offers: number[] }>();
  for (const o of (data ?? []) as Partial<PriceObservationRow>[]) {
    const day = String(o.observed_at).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { sell: [], buy: [], offers: [] });
    const b = byDay.get(day)!;
    if (typeof o.sell_price === "number") b.sell.push(o.sell_price);
    if (typeof o.buy_price === "number") b.buy.push(o.buy_price);
    if (typeof o.offer_count === "number") b.offers.push(o.offer_count);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      sell: avg(v.sell) === null ? null : Math.round(avg(v.sell)!),
      buy: avg(v.buy) === null ? null : Math.round(avg(v.buy)!),
      offers: avg(v.offers) === null ? null : Math.round(avg(v.offers)!),
    }));
}

export interface DashboardSummary {
  todayRealized: number;
  monthRealized: number;
  allTimeRealized: number;
  openPositions: number;
  openUnits: number;
  deployedCapital: number;
  unrealized: number;
  openSignals: number;
  pendingCandidates: number;
  winRate: number | null;
  avgHoldingDays: number | null;
  salesCount: number;
}

export async function dashboardSummary(): Promise<DashboardSummary> {
  const db = supabaseAdmin();
  const [{ data: sales }, { data: positions }, { count: signals }, { count: pending }] =
    await Promise.all([
      db.from("sales").select("*").order("sold_at", { ascending: false }).limit(1000),
      db.from("positions").select("*").in("status", ["holding", "listed"]),
      db.from("exit_signals").select("*", { count: "exact", head: true }).eq("resolved", false),
      db
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("passed", true),
    ]);

  const s = (sales ?? []) as SaleRow[];
  const p = (positions ?? []) as PositionRow[];

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const sum = (xs: SaleRow[]) => xs.reduce((a, c) => a + Number(c.realized_profit), 0);
  const todayRealized = sum(s.filter((x) => new Date(x.sold_at) >= startOfDay));
  const monthRealized = sum(s.filter((x) => new Date(x.sold_at) >= startOfMonth));
  const allTimeRealized = sum(s);

  const deployedCapital = p.reduce((a, c) => a + c.qty * Number(c.acquisition_cost), 0);
  const openUnits = p.reduce((a, c) => a + c.qty, 0);

  const wins = s.filter((x) => Number(x.realized_profit) > 0).length;
  const winRate = s.length ? wins / s.length : null;
  const avgHoldingDays = s.length ? s.reduce((a, c) => a + Number(c.holding_days), 0) / s.length : null;

  return {
    todayRealized,
    monthRealized,
    allTimeRealized,
    openPositions: p.length,
    openUnits,
    deployedCapital,
    unrealized: 0, // 現在価格は在庫一覧で個別に評価する
    openSignals: signals ?? 0,
    pendingCandidates: pending ?? 0,
    winRate,
    avgHoldingDays,
    salesCount: s.length,
  };
}

/** 在庫1件ぶんの現況（最新価格・含み損益・保有日数） */
export async function positionSnapshot(pos: PositionWithProduct) {
  const { data } = await supabaseAdmin()
    .from("price_observations")
    .select("sell_price, offer_count, sales_rank, observed_at")
    .eq("asin", pos.asin)
    .order("observed_at", { ascending: false })
    .limit(1);

  const latest = (data ?? [])[0] as Partial<PriceObservationRow> | undefined;
  const current = typeof latest?.sell_price === "number" ? latest.sell_price : null;
  const held = holdingDays(pos.opened_at, pos.closed_at);
  const unrealizedPerUnit = current === null ? null : current - Number(pos.acquisition_cost);

  return {
    current,
    offerCount: latest?.offer_count ?? null,
    salesRank: latest?.sales_rank ?? null,
    observedAt: latest?.observed_at ?? null,
    heldDays: held,
    unrealized: unrealizedPerUnit === null ? null : unrealizedPerUnit * pos.qty,
  };
}
