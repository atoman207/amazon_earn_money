import "server-only";
import { calcProfit } from "@/lib/domain/profit";
import type { AppSettings } from "@/lib/domain/types";
import { loadSettings } from "@/lib/server/settings";
import { analyzeUniverse, type AnalysisRow } from "@/lib/server/steps/analysis";
import { inventoryView, type InventoryView, type PositionView } from "@/lib/server/steps/inventory";
import { loadUniverse, type AsinSnapshot } from "@/lib/server/steps/universe";

/**
 * ⑦ 損切り・リスク管理。
 *
 * 「いくら損しているか」ではなく「いま何をすべきか」を出す工程。
 * 損切りラインまでの距離、長期在庫の処分、相場の急落、そして
 * そもそも買わないための除外まで、判断に必要な数字を並べる。
 */

export interface StopLossRow extends PositionView {
  /** 損切りラインまでの距離（円）。負なら割り込んでいる */
  toStop: number | null;
  /** 損切りラインまでの距離（率） */
  toStopRate: number | null;
  /** いま売った場合の手取り（手数料差引後・数量ぶん） */
  proceedsIfSoldNow: number | null;
  /** いま売った場合の損益（数量ぶん） */
  profitIfSoldNow: number | null;
  breached: boolean;
}

function sellNow(view: PositionView, settings: AppSettings) {
  const product = view.position.products;
  if (view.current === null || !product) return { proceeds: null, profit: null };
  const p = calcProfit({
    buyPrice: Number(view.position.acquisition_cost),
    expectedSellPrice: view.current,
    referralFeeRate: product.referral_fee_rate,
    sizeTier: product.size_tier,
    holdingDays: view.heldDays,
    costs: settings.costs,
  });
  return {
    proceeds: p.netProceeds * view.position.qty,
    // 取得原価は支払い済みなので、ここでは「売って手元に残る差額」を出す
    profit: (p.netProceeds - Number(view.position.acquisition_cost)) * view.position.qty,
  };
}

/** 損切りラインの通知（⑦-1） */
export async function stopLossView(): Promise<{
  rows: StopLossRow[];
  inventory: InventoryView;
  breached: number;
}> {
  const inventory = await inventoryView();
  const settings = inventory.settings;

  const rows: StopLossRow[] = inventory.rows
    .map((view) => {
      const stop = Number(view.position.stop_price);
      const { proceeds, profit } = sellNow(view, settings);
      return {
        ...view,
        toStop: view.current === null ? null : view.current - stop,
        toStopRate: view.current === null || stop <= 0 ? null : view.current / stop - 1,
        proceedsIfSoldNow: proceeds,
        profitIfSoldNow: profit,
        breached: view.current !== null && view.current < stop,
      };
    })
    .sort((a, b) => (a.toStopRate ?? 99) - (b.toStopRate ?? 99));

  return { rows, inventory, breached: rows.filter((r) => r.breached).length };
}

export interface LongTermRow extends StopLossRow {
  /** 何日超過しているか */
  overDays: number;
  /** 成行までの残り日数 */
  toForceSell: number;
  /** 保管料が想定利益に占める割合 */
  storageRatio: number | null;
  recommendation: string;
}

/** 長期在庫の売却判断（⑦-2）。図解の「45〜60日」は設定の timeStopDays にあたる。 */
export async function longTermView(): Promise<{
  rows: LongTermRow[];
  settings: AppSettings;
  thresholdDays: number;
  forceSellDays: number;
}> {
  const { rows: stopRows, inventory } = await stopLossView();
  const t = inventory.settings.thresholds;

  const rows: LongTermRow[] = stopRows
    .filter((r) => r.heldDays >= t.timeStopDays)
    .map((r) => {
      const expected =
        (Number(r.position.target_price) - Number(r.position.acquisition_cost)) * r.position.qty;
      const storageRatio = expected > 0 ? r.storageAccrued / expected : null;

      let recommendation: string;
      if (r.heldDays >= t.forceSellDays) {
        recommendation = `${t.forceSellDays}日を超えています。現金化を優先し、成行で手仕舞ってください。`;
      } else if (storageRatio !== null && storageRatio > t.storageRatioCap) {
        recommendation = `保管料が想定利益の ${(storageRatio * 100).toFixed(0)}% に達しています。持ち続けるほど利益が削れます。`;
      } else if (r.profitIfSoldNow !== null && r.profitIfSoldNow > 0) {
        recommendation = "いま売っても利益が残ります。段階値下げで確実に回してください。";
      } else {
        recommendation = "値下げを進めながら、成行の期限までに出し切る前提で扱ってください。";
      }

      return {
        ...r,
        overDays: r.heldDays - t.timeStopDays,
        toForceSell: Math.max(0, t.forceSellDays - r.heldDays),
        storageRatio,
        recommendation,
      };
    })
    .sort((a, b) => b.heldDays - a.heldDays);

  return {
    rows,
    settings: inventory.settings,
    thresholdDays: t.timeStopDays,
    forceSellDays: t.forceSellDays,
  };
}

export interface CrashRow {
  asin: string;
  title: string;
  current: number | null;
  /** 7日前の価格 */
  weekAgo: number | null;
  median30: number | null;
  /** 7日での変化率（負なら下落） */
  weekChange: number | null;
  /** 30日中央値からの乖離 */
  vsMedian: number | null;
  offerCount: number;
  offerDelta: number | null;
  held: boolean;
  severity: "crash" | "watch" | "calm";
  note: string;
}

/** 相場が急に落ちたと言える下落率 */
const CRASH_WEEK = -0.15;
const WATCH_WEEK = -0.07;

/** 市場価格の急落を検知（⑦-3） */
export async function crashView(limit = 120): Promise<{ rows: CrashRow[]; crashes: number }> {
  const [snapshots, inventory] = await Promise.all([loadUniverse({ limit }), inventoryView()]);
  const heldAsins = new Set(inventory.rows.map((r) => r.position.asin));
  const weekAgoDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const rows = snapshots
    .map((s: AsinSnapshot): CrashRow => {
      const daily = s.daily;
      const current = daily.length ? daily[daily.length - 1].price : null;
      const older = [...daily].reverse().find((d) => d.date <= weekAgoDate);
      const weekAgo = older?.price ?? null;
      const weekChange = current !== null && weekAgo ? current / weekAgo - 1 : null;
      const vsMedian = current !== null && s.stats.median30 ? current / s.stats.median30 - 1 : null;
      const offerCount = s.latest?.offer_count ?? s.stats.baselineOfferCount;
      const surging = (s.offerDelta ?? 0) >= 3;

      const severity: CrashRow["severity"] =
        weekChange !== null && weekChange <= CRASH_WEEK
          ? "crash"
          : (weekChange !== null && weekChange <= WATCH_WEEK) || surging
            ? "watch"
            : "calm";

      const note =
        severity === "crash"
          ? `7日で ${((weekChange ?? 0) * 100).toFixed(1)}% 下落しています。保有していれば売り、候補なら見送りです。`
          : severity === "watch"
            ? surging
              ? `競合が7日で ${s.offerDelta}社 増えています。値崩れの前触れです。`
              : `7日で ${((weekChange ?? 0) * 100).toFixed(1)}% 下がっています。様子を見てください。`
            : "落ち着いています。";

      return {
        asin: s.asin,
        title: s.product.title,
        current,
        weekAgo,
        median30: s.stats.median30,
        weekChange,
        vsMedian,
        offerCount,
        offerDelta: s.offerDelta,
        held: heldAsins.has(s.asin),
        severity,
        note,
      };
    })
    .sort((a, b) => {
      const rank = { crash: 0, watch: 1, calm: 2 } as const;
      if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
      return (a.weekChange ?? 0) - (b.weekChange ?? 0);
    });

  return { rows, crashes: rows.filter((r) => r.severity === "crash").length };
}

export interface ExcludeView {
  rows: AnalysisRow[];
  excluded: number;
  caution: number;
  ok: number;
  settings: AppSettings;
}

/** リスクの高い商品を事前に除外（⑦-4） */
export async function excludeView(limit = 120): Promise<ExcludeView> {
  const [{ rows }, settings] = await Promise.all([analyzeUniverse(limit), loadSettings()]);

  const rank = { exclude: 0, caution: 1, ok: 2 } as const;
  const sorted = [...rows].sort((a, b) => {
    const ra = rank[a.screen.verdict];
    const rb = rank[b.screen.verdict];
    if (ra !== rb) return ra - rb;
    return b.screen.checks.length - a.screen.checks.length;
  });

  return {
    rows: sorted,
    excluded: rows.filter((r) => r.screen.verdict === "exclude").length,
    caution: rows.filter((r) => r.screen.verdict === "caution").length,
    ok: rows.filter((r) => r.screen.verdict === "ok").length,
    settings,
  };
}
