import "server-only";
import {
  backtest,
  isReliable,
  type BacktestParams,
  type BacktestResult,
} from "@/lib/domain/backtest";
import { loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PriceObservationRow, ProductRow } from "@/lib/supabase/database.types";

/**
 * 保存済みの価格観測でバックテストを回す。
 * 既定は直近365日（提案書の「過去6〜12ヶ月」に合わせる）。
 */

export interface AsinBacktest extends BacktestResult {
  asin: string;
  reliable: boolean;
  /** 検証に使った日数の指定 */
  windowDays: number;
}

export async function backtestAsin(
  asin: string,
  windowDays = 365,
  params?: Partial<BacktestParams>,
): Promise<AsinBacktest> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const [{ data: product }, { data: observations }] = await Promise.all([
    db.from("products").select("*").eq("asin", asin).maybeSingle(),
    db
      .from("price_observations")
      .select("*")
      .eq("asin", asin)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(8000),
  ]);

  const settings = await loadSettings();
  const p = product as ProductRow | null;

  const result = backtest({
    observations: ((observations as PriceObservationRow[] | null) ?? []).map((o) => ({
      observedAt: o.observed_at,
      buyPrice: o.buy_price,
      sellPrice: o.sell_price,
      inStock: o.in_stock,
    })),
    referralFeeRate: p?.referral_fee_rate ?? 0.1,
    sizeTier: p?.size_tier ?? "standard",
    costs: settings.costs,
    params,
  });

  return { ...result, asin, reliable: isReliable(result), windowDays };
}

export interface BacktestSummary {
  asins: number;
  /** 検証できた（決着した取引がある）銘柄の数 */
  evaluated: number;
  totalTrades: number;
  winRate: number | null;
  avgRoi: number | null;
  avgHoldingDays: number | null;
  maxLoss: number | null;
  profitFactor: number | null;
  totalProfit: number;
}

/**
 * 監視している銘柄をまとめて検証する。
 * 「この条件で運用していたら全体としてどうだったか」を見るためのもの。
 */
export async function backtestWatched(
  limit = 100,
  windowDays = 365,
  params?: Partial<BacktestParams>,
): Promise<{ summary: BacktestSummary; results: AsinBacktest[] }> {
  const { data } = await supabaseAdmin()
    .from("watch_universe")
    .select("asin")
    .eq("active", true)
    .limit(limit);

  const asins = ((data as Array<{ asin: string }> | null) ?? []).map((w) => w.asin);
  const results: AsinBacktest[] = [];
  for (const asin of asins) {
    results.push(await backtestAsin(asin, windowDays, params));
  }

  const closed = results.flatMap((r) => r.trades.filter((t) => t.exitReason !== "open"));
  const wins = closed.filter((t) => t.netProfit > 0);
  const losses = closed.filter((t) => t.netProfit < 0);
  const grossProfit = wins.reduce((a, t) => a + t.netProfit, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netProfit, 0));

  return {
    summary: {
      asins: asins.length,
      evaluated: results.filter((r) => r.closed > 0).length,
      totalTrades: closed.length,
      winRate: closed.length ? wins.length / closed.length : null,
      avgRoi: closed.length ? closed.reduce((a, t) => a + t.roi, 0) / closed.length : null,
      avgHoldingDays: closed.length
        ? closed.reduce((a, t) => a + t.holdingDays, 0) / closed.length
        : null,
      maxLoss: losses.length ? Math.min(...losses.map((t) => t.netProfit)) : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      totalProfit: closed.reduce((a, t) => a + t.netProfit, 0),
    },
    results,
  };
}
