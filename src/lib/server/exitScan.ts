import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateExit } from "@/lib/domain/exit";
import { loadSettings } from "@/lib/server/settings";
import { holdingDays } from "@/lib/format";
import { summarizeHistory } from "@/lib/server/pipeline";
import type { PriceObservationRow } from "@/lib/supabase/database.types";

/**
 * 保有中の在庫すべてについて、毎日の出口判定を行う（提案書 3.5節）。
 * 同じルールが続けて鳴り続けないよう、未解決の同ルールがあれば作り直さない。
 */
export async function runExitScan() {
  const db = supabaseAdmin();
  const settings = await loadSettings();

  const { data: positions } = await db
    .from("positions")
    .select("*, products(*)")
    .in("status", ["holding", "listed"]);

  let fired = 0;
  const details: Array<{ positionId: string; rules: string[] }> = [];

  for (const pos of positions ?? []) {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data: obs } = await db
      .from("price_observations")
      .select("*")
      .eq("asin", pos.asin)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(5000);

    const rows = (obs ?? []) as PriceObservationRow[];
    if (!rows.length) continue;

    const stats = summarizeHistory(rows);
    const latest = rows[rows.length - 1];
    const current = latest.sell_price ?? 0;
    if (!current) continue;

    // 保有開始以降の最高値をトレーリングの基準にする
    const sinceOpen = rows.filter((r) => new Date(r.observed_at) >= new Date(pos.opened_at));
    const peakObserved = Math.max(
      Number(pos.peak_price ?? 0),
      ...sinceOpen.map((r) => r.sell_price ?? 0),
    );
    if (peakObserved > Number(pos.peak_price ?? 0)) {
      await db.from("positions").update({ peak_price: peakObserved }).eq("id", pos.id);
    }

    // ランキングの傾き（負なら売れている）
    const recent = rows.slice(-14).map((r) => r.sales_rank).filter((v): v is number => typeof v === "number");
    const trend =
      recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / Math.max(1, recent[0]) : 0;

    const held = holdingDays(pos.opened_at);
    const signals = evaluateExit({
      acquisitionCost: Number(pos.acquisition_cost),
      targetPrice: Number(pos.target_price),
      stopPrice: Number(pos.stop_price),
      currentPrice: current,
      peakPrice: peakObserved || null,
      holdingDays: held,
      median90: stats.median90,
      buyPrice: Number(pos.acquisition_cost),
      offerCount: latest.offer_count ?? stats.baselineOfferCount,
      baselineOfferCount: stats.baselineOfferCount,
      salesRankTrend: trend,
      storageAccrued: held * settings.costs.storageFeePerDay * pos.qty,
      expectedNetProfit: (Number(pos.target_price) - Number(pos.acquisition_cost)) * pos.qty,
      thresholds: settings.thresholds,
    });

    if (!signals.length) continue;

    const { data: openSignals } = await db
      .from("exit_signals")
      .select("rule")
      .eq("position_id", pos.id)
      .eq("resolved", false);
    const already = new Set((openSignals ?? []).map((s) => s.rule));

    const fresh = signals.filter((s) => !already.has(s.rule));
    if (!fresh.length) continue;

    const { error } = await db.from("exit_signals").insert(
      fresh.map((s) => ({
        position_id: pos.id,
        rule: s.rule,
        kind: s.kind,
        message: s.message,
        current_price: current,
      })),
    );
    if (!error) {
      fired += fresh.length;
      details.push({ positionId: pos.id, rules: fresh.map((s) => s.rule) });
    }
  }

  return { positions: positions?.length ?? 0, fired, details };
}
