import "server-only";
import { evaluateExit, steppedPrice, type ExitSignal } from "@/lib/domain/exit";
import { planResell, type ResellPlan } from "@/lib/domain/resell";
import type { AppSettings } from "@/lib/domain/types";
import { holdingDays } from "@/lib/format";
import { summarizeHistory } from "@/lib/server/pipeline";
import { loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  ExitSignalRow,
  PositionRow,
  PriceObservationRow,
  ProductRow,
  WatchRow,
} from "@/lib/supabase/database.types";

/**
 * ⑥ 販売・在庫管理。
 *
 * 保有している在庫1件ごとに、
 *   いまいくらか／目標と損切りのどこにいるか／何日持っているか／いくらで出すべきか
 * を一度にそろえる。⑦（損切り・リスク）も同じ材料を使うので、取得はここに集約する。
 */

export type PositionWithProduct = PositionRow & { products: ProductRow | null };

export interface PositionView {
  position: PositionWithProduct;
  /** いまの市場価格 */
  current: number | null;
  offerCount: number | null;
  salesRank: number | null;
  observedAt: string | null;
  heldDays: number;
  /** 含み損益（数量ぶん） */
  unrealized: number | null;
  /** 取得原価に対する含み損益の率 */
  unrealizedRate: number | null;
  median90: number | null;
  peak: number | null;
  /** 発生済みの保管料（数量ぶん） */
  storageAccrued: number;
  /** 価格が古い（2日以上取れていない）か */
  stale: boolean;
  signals: ExitSignalRow[];
  /** いま判定するとどうなるか（保存済みシグナルとは別に、その場で計算する） */
  live: ExitSignal[];
  plan: ResellPlan;
  /** 段階値下げの予定 */
  markdown: Array<{ day: number; price: number; note: string }>;
  daily: Array<{ date: string; price: number }>;
}

export interface InventoryView {
  rows: PositionView[];
  settings: AppSettings;
  totals: {
    positions: number;
    units: number;
    deployed: number;
    unrealized: number;
    aging: number;
    /** 価格が古くて判定できない在庫 */
    stale: number;
    takeProfit: number;
    stopLoss: number;
  };
  /** 監視だけしている銘柄（まだ買っていないもの） */
  watching: Array<{ watch: WatchRow; title: string; current: number | null; observedAt: string | null }>;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function toDaily(rows: PriceObservationRow[]) {
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

/** 段階値下げの予定表。いつ・いくらまで下げるかを先に見せる。 */
function markdownPlan(
  listPrice: number,
  floorPrice: number,
  settings: AppSettings,
): Array<{ day: number; price: number; note: string }> {
  const t = settings.thresholds;
  const span = Math.max(1, t.forceSellDays - t.timeStopDays);
  const marks = [
    { day: t.timeStopDays, note: "値下げ開始" },
    { day: t.timeStopDays + Math.round(span * 0.33), note: "1段階目" },
    { day: t.timeStopDays + Math.round(span * 0.66), note: "2段階目" },
    { day: t.forceSellDays, note: "成行（下限）" },
  ];
  return marks.map((m) => ({
    day: m.day,
    price: steppedPrice(Math.round(listPrice), floorPrice, m.day, t),
    note: m.note,
  }));
}

/**
 * 保有中の在庫をまとめて読む。
 * 価格の履歴は90日ぶんを1回で取り、ASIN ごとに束ねる（件数ぶん往復しない）。
 */
export async function inventoryView(): Promise<InventoryView> {
  const db = supabaseAdmin();
  const settings = await loadSettings();

  const [{ data: positionRows }, { data: signalRows }] = await Promise.all([
    db.from("positions").select("*, products(*)").in("status", ["holding", "listed"]).order("opened_at"),
    db.from("exit_signals").select("*").eq("resolved", false).order("fired_at", { ascending: false }),
  ]);

  const positions = (positionRows ?? []) as unknown as PositionWithProduct[];
  const signals = (signalRows as ExitSignalRow[] | null) ?? [];

  const signalsByPosition = new Map<string, ExitSignalRow[]>();
  for (const s of signals) {
    if (!signalsByPosition.has(s.position_id)) signalsByPosition.set(s.position_id, []);
    signalsByPosition.get(s.position_id)!.push(s);
  }

  const asins = [...new Set(positions.map((p) => p.asin))];
  const observations = new Map<string, PriceObservationRow[]>();
  if (asins.length) {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    for (let i = 0; i < asins.length; i += 40) {
      const { data } = await db
        .from("price_observations")
        .select("*")
        .in("asin", asins.slice(i, i + 40))
        .gte("observed_at", since)
        .order("observed_at", { ascending: true })
        .limit(20000);
      for (const o of (data as PriceObservationRow[] | null) ?? []) {
        if (!observations.has(o.asin)) observations.set(o.asin, []);
        observations.get(o.asin)!.push(o);
      }
    }
  }

  const rows: PositionView[] = positions.map((position) => {
    const obs = observations.get(position.asin) ?? [];
    const stats = summarizeHistory(obs);
    const latest = obs.length ? obs[obs.length - 1] : null;
    const current = typeof latest?.sell_price === "number" ? latest.sell_price : null;
    const heldDays = holdingDays(position.opened_at, position.closed_at);
    const acquisitionCost = Number(position.acquisition_cost);

    const sinceOpen = obs.filter((o) => new Date(o.observed_at) >= new Date(position.opened_at));
    const peak = Math.max(
      Number(position.peak_price ?? 0),
      ...sinceOpen.map((o) => o.sell_price ?? 0),
      0,
    );

    const storageAccrued = heldDays * settings.costs.storageFeePerDay * position.qty;

    const live = current
      ? evaluateExit({
          acquisitionCost,
          targetPrice: Number(position.target_price),
          stopPrice: Number(position.stop_price),
          currentPrice: current,
          peakPrice: peak || null,
          holdingDays: heldDays,
          median90: stats.median90,
          buyPrice: acquisitionCost,
          offerCount: latest?.offer_count ?? stats.baselineOfferCount,
          baselineOfferCount: stats.baselineOfferCount,
          salesRankTrend: (() => {
            const ranks = obs
              .slice(-14)
              .map((o) => o.sales_rank)
              .filter((v): v is number => typeof v === "number" && v > 0);
            return ranks.length >= 2 ? (ranks[ranks.length - 1] - ranks[0]) / Math.max(1, ranks[0]) : 0;
          })(),
          storageAccrued,
          expectedNetProfit: (Number(position.target_price) - acquisitionCost) * position.qty,
          thresholds: settings.thresholds,
        })
      : [];

    const plan = planResell({
      acquisitionCost,
      targetPrice: Number(position.target_price),
      stopPrice: Number(position.stop_price),
      currentPrice: current ?? 0,
      median90: stats.median90,
      qty: position.qty,
      holdingDays: heldDays,
      signals: live,
      thresholds: settings.thresholds,
    });

    const floor = Math.max(1, Math.round(acquisitionCost * (1 + settings.thresholds.stopLossRate)));
    const unrealized = current === null ? null : (current - acquisitionCost) * position.qty;

    return {
      position,
      current,
      offerCount: latest?.offer_count ?? null,
      salesRank: latest?.sales_rank ?? null,
      observedAt: latest?.observed_at ?? null,
      stale: !latest || Date.now() - new Date(latest.observed_at).getTime() > 2 * 86_400_000,
      heldDays,
      unrealized,
      unrealizedRate:
        current === null || acquisitionCost <= 0 ? null : (current - acquisitionCost) / acquisitionCost,
      median90: stats.median90,
      peak: peak || null,
      storageAccrued,
      signals: signalsByPosition.get(position.id) ?? [],
      live,
      plan,
      markdown: markdownPlan(Math.max(Number(position.target_price), current ?? 0), floor, settings),
      daily: toDaily(obs),
    };
  });

  const { data: watchRows } = await db
    .from("watch_universe")
    .select("*, products(title)")
    .eq("active", true)
    .order("priority", { ascending: false })
    .limit(60);

  const heldAsins = new Set(positions.map((p) => p.asin));
  const watchAsins = ((watchRows ?? []) as unknown as Array<WatchRow & { products: { title: string } | null }>)
    .filter((w) => !heldAsins.has(w.asin));

  const latestByAsin = new Map<string, { price: number | null; at: string | null }>();
  if (watchAsins.length) {
    const { data } = await db
      .from("price_observations")
      .select("asin, sell_price, observed_at")
      .in("asin", watchAsins.slice(0, 60).map((w) => w.asin))
      .order("observed_at", { ascending: true })
      .limit(20000);
    for (const o of (data as Array<{ asin: string; sell_price: number | null; observed_at: string }> | null) ?? []) {
      latestByAsin.set(o.asin, { price: o.sell_price, at: o.observed_at });
    }
  }

  return {
    rows,
    settings,
    totals: {
      positions: rows.length,
      units: rows.reduce((a, r) => a + r.position.qty, 0),
      deployed: rows.reduce((a, r) => a + r.position.qty * Number(r.position.acquisition_cost), 0),
      unrealized: rows.reduce((a, r) => a + (r.unrealized ?? 0), 0),
      aging: rows.filter((r) => r.heldDays >= settings.thresholds.timeStopDays).length,
      stale: rows.filter((r) => r.stale).length,
      takeProfit: rows.filter((r) => r.live.some((s) => s.kind === "take_profit")).length,
      stopLoss: rows.filter((r) => r.live.some((s) => s.kind === "stop_loss")).length,
    },
    watching: watchAsins.map((w) => ({
      watch: w,
      title: w.products?.title ?? w.asin,
      current: latestByAsin.get(w.asin)?.price ?? null,
      observedAt: latestByAsin.get(w.asin)?.at ?? null,
    })),
  };
}
