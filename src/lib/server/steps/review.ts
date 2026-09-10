import "server-only";
import { failureLabel, suggestThresholds, type ImproveResult } from "@/lib/domain/improve";
import { analyzePrecision, type DecisionOutcome, type PrecisionResult } from "@/lib/domain/precision";
import type { AppSettings } from "@/lib/domain/types";
import { loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  OpportunityRow,
  OrderRow,
  PositionRow,
  ProductRow,
  SaleRow,
} from "@/lib/supabase/database.types";

/**
 * ⑧ 結果分析・改善。
 *
 * 集計して終わりにしない。「どこで負けたか」「読みはどちらへ外れたか」まで出し、
 * 次の設定変更につなげる。設定を勝手に書き換えることはしない（提案までが仕事）。
 */

export type SaleWithProduct = SaleRow & { products: ProductRow | null };

export interface SummaryView {
  sales: SaleWithProduct[];
  totals: {
    realized: number;
    revenue: number;
    fees: number;
    units: number;
    count: number;
    winRate: number | null;
    avgRoi: number | null;
    avgHoldingDays: number | null;
    profitFactor: number | null;
    grossProfit: number;
    grossLoss: number;
  };
  byMonth: Array<{ month: string; profit: number; revenue: number; units: number; count: number }>;
  byCategory: Array<{ category: string; profit: number; revenue: number; units: number }>;
  byRule: Array<{ rule: string; profit: number; count: number }>;
  /** 今月の確定利益 */
  thisMonthProfit: number;
  /** 保有中の在庫（含み損益の材料） */
  openPositions: { count: number; units: number; deployed: number };
}

/** 実績の自動集計（⑧-1） */
export async function summaryView(limit = 500): Promise<SummaryView> {
  const db = supabaseAdmin();
  const [{ data: saleRows }, { data: positionRows }] = await Promise.all([
    db.from("sales").select("*, products(*)").order("sold_at", { ascending: false }).limit(limit),
    db.from("positions").select("*").in("status", ["holding", "listed"]),
  ]);

  const sales = (saleRows ?? []) as unknown as SaleWithProduct[];
  const positions = (positionRows as PositionRow[] | null) ?? [];

  const realized = sales.reduce((a, s) => a + Number(s.realized_profit), 0);
  const revenue = sales.reduce((a, s) => a + Number(s.sell_price) * s.qty, 0);
  const fees = sales.reduce((a, s) => a + Number(s.fees), 0);
  const wins = sales.filter((s) => Number(s.realized_profit) > 0);
  const losses = sales.filter((s) => Number(s.realized_profit) < 0);
  const grossProfit = wins.reduce((a, s) => a + Number(s.realized_profit), 0);
  const grossLoss = Math.abs(losses.reduce((a, s) => a + Number(s.realized_profit), 0));

  const roiOf = (s: SaleWithProduct) => {
    const cost = Number(s.sell_price) * s.qty - Number(s.realized_profit);
    return cost > 0 ? Number(s.realized_profit) / cost : 0;
  };

  const byMonth = new Map<string, { profit: number; revenue: number; units: number; count: number }>();
  const byCategory = new Map<string, { profit: number; revenue: number; units: number }>();
  const byRule = new Map<string, { profit: number; count: number }>();

  for (const s of sales) {
    const m = s.sold_at.slice(0, 7);
    const cm = byMonth.get(m) ?? { profit: 0, revenue: 0, units: 0, count: 0 };
    cm.profit += Number(s.realized_profit);
    cm.revenue += Number(s.sell_price) * s.qty;
    cm.units += s.qty;
    cm.count += 1;
    byMonth.set(m, cm);

    const c = s.products?.category ?? "未分類";
    const cc = byCategory.get(c) ?? { profit: 0, revenue: 0, units: 0 };
    cc.profit += Number(s.realized_profit);
    cc.revenue += Number(s.sell_price) * s.qty;
    cc.units += s.qty;
    byCategory.set(c, cc);

    const r = s.exit_rule ?? "（手動）";
    const cr = byRule.get(r) ?? { profit: 0, count: 0 };
    cr.profit += Number(s.realized_profit);
    cr.count += 1;
    byRule.set(r, cr);
  }

  return {
    sales,
    totals: {
      realized,
      revenue,
      fees,
      units: sales.reduce((a, s) => a + s.qty, 0),
      count: sales.length,
      winRate: sales.length ? wins.length / sales.length : null,
      avgRoi: sales.length ? sales.reduce((a, s) => a + roiOf(s), 0) / sales.length : null,
      avgHoldingDays: sales.length
        ? sales.reduce((a, s) => a + Number(s.holding_days), 0) / sales.length
        : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      grossProfit,
      grossLoss,
    },
    byMonth: [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => b.month.localeCompare(a.month)),
    byCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.profit - a.profit),
    byRule: [...byRule.entries()]
      .map(([rule, v]) => ({ rule, ...v }))
      .sort((a, b) => b.profit - a.profit),
    thisMonthProfit: byMonth.get(new Date().toISOString().slice(0, 7))?.profit ?? 0,
    openPositions: {
      count: positions.length,
      units: positions.reduce((a, p) => a + p.qty, 0),
      deployed: positions.reduce((a, p) => a + p.qty * Number(p.acquisition_cost), 0),
    },
  };
}

export interface FactorGroup {
  key: string;
  count: number;
  profit: number;
  winRate: number;
  avgHoldingDays: number;
}

export interface FactorsView {
  /** 損の原因の内訳（記録されているものだけ） */
  failures: Array<{ code: string; label: string; count: number; loss: number }>;
  /** 原因が記録されていない損失の件数 */
  unlabeledLosses: number;
  byCategory: FactorGroup[];
  byRule: FactorGroup[];
  byHolding: FactorGroup[];
  best: SaleWithProduct[];
  worst: SaleWithProduct[];
  notes: string[];
}

const holdingBucket = (days: number) =>
  days <= 7 ? "7日以内" : days <= 30 ? "8〜30日" : days <= 60 ? "31〜60日" : "61日以上";

function groupSales(sales: SaleWithProduct[], keyOf: (s: SaleWithProduct) => string): FactorGroup[] {
  const map = new Map<string, SaleWithProduct[]>();
  for (const s of sales) {
    const k = keyOf(s);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      count: list.length,
      profit: list.reduce((a, s) => a + Number(s.realized_profit), 0),
      winRate: list.filter((s) => Number(s.realized_profit) > 0).length / list.length,
      avgHoldingDays: list.reduce((a, s) => a + Number(s.holding_days), 0) / list.length,
    }))
    .sort((a, b) => b.profit - a.profit);
}

/** 成功・失敗の要因分析（⑧-2） */
export async function factorsView(): Promise<FactorsView> {
  const { sales } = await summaryView();
  const losses = sales.filter((s) => Number(s.realized_profit) < 0);

  const counts = new Map<string, { count: number; loss: number }>();
  for (const s of losses) {
    const code = s.failure_reason_code ?? null;
    if (!code) continue;
    const cur = counts.get(code) ?? { count: 0, loss: 0 };
    cur.count += 1;
    cur.loss += Number(s.realized_profit);
    counts.set(code, cur);
  }

  const notes: string[] = [];
  const byCategory = groupSales(sales, (s) => s.products?.category ?? "未分類");
  const byRule = groupSales(sales, (s) => s.exit_rule ?? "（手動）");
  const byHolding = groupSales(sales, (s) => holdingBucket(Number(s.holding_days)));

  if (sales.length === 0) {
    notes.push("売却の記録がまだありません。⑥で売却を記録すると、ここに要因が出ます。");
  } else {
    const worstCategory = [...byCategory].reverse()[0];
    if (worstCategory && worstCategory.profit < 0) {
      notes.push(
        `「${worstCategory.key}」は通算 ${Math.round(worstCategory.profit).toLocaleString("ja-JP")}円 の負けです（${worstCategory.count}件）。このカテゴリの条件を見直してください。`,
      );
    }
    const bestRule = byRule[0];
    if (bestRule && bestRule.count >= 2) {
      notes.push(
        `いちばん効いている出口は「${bestRule.key}」で、${bestRule.count}件・${Math.round(bestRule.profit).toLocaleString("ja-JP")}円 を稼いでいます。`,
      );
    }
    const slow = byHolding.find((g) => g.key === "61日以上");
    if (slow && slow.count >= 2 && slow.profit < 0) {
      notes.push(
        `61日以上持ったものは ${slow.count}件すべて合わせて ${Math.round(slow.profit).toLocaleString("ja-JP")}円 です。長く持つほど負けています。`,
      );
    }
  }

  return {
    failures: [...counts.entries()]
      .map(([code, v]) => ({ code, label: failureLabel(code), ...v }))
      .sort((a, b) => b.count - a.count),
    unlabeledLosses: losses.filter((s) => !s.failure_reason_code).length,
    byCategory,
    byRule,
    byHolding,
    best: [...sales].sort((a, b) => Number(b.realized_profit) - Number(a.realized_profit)).slice(0, 5),
    worst: [...sales].sort((a, b) => Number(a.realized_profit) - Number(b.realized_profit)).slice(0, 5),
    notes,
  };
}

export interface LogicView {
  improve: ImproveResult;
  settings: AppSettings;
}

/** ロジックの改善（⑧-3）。提案を出すだけで、適用は人が押す。 */
export async function logicView(): Promise<LogicView> {
  const [{ sales }, settings] = await Promise.all([summaryView(), loadSettings()]);

  return {
    improve: suggestThresholds({
      sales: sales.map((s) => ({
        realizedProfit: Number(s.realized_profit),
        holdingDays: Number(s.holding_days),
        failureReasonCode: s.failure_reason_code ?? null,
      })),
      thresholds: settings.thresholds,
    }),
    settings,
  };
}

export interface PrecisionView {
  result: PrecisionResult;
  rows: DecisionOutcome[];
  /** 判定までさかのぼれなかった売却の件数 */
  unmatched: number;
}

/**
 * 判定と結果の答え合わせ（⑧-4）。
 *
 * 売却 → ポジション → 発注 → 候補 とさかのぼり、
 * 「買うと決めたときの見込み」と「実際」を1件ずつ突き合わせる。
 * 手で作ったポジションなど、さかのぼれないものは数に入れず別に数える。
 */
export async function precisionView(limit = 300): Promise<PrecisionView> {
  const db = supabaseAdmin();

  const { data: saleRows } = await db
    .from("sales")
    .select("*, products(*)")
    .order("sold_at", { ascending: false })
    .limit(limit);
  const sales = (saleRows ?? []) as unknown as SaleWithProduct[];
  if (!sales.length) return { result: analyzePrecision([]), rows: [], unmatched: 0 };

  const positionIds = [...new Set(sales.map((s) => s.position_id))];
  const { data: positionRows } = await db.from("positions").select("*").in("id", positionIds);
  const positions = new Map(((positionRows as PositionRow[] | null) ?? []).map((p) => [p.id, p]));

  const orderIds = [...new Set([...positions.values()].map((p) => p.order_id).filter((v): v is string => Boolean(v)))];
  const orders = new Map<string, OrderRow>();
  if (orderIds.length) {
    const { data: orderRows } = await db.from("orders").select("*").in("id", orderIds);
    for (const o of (orderRows as OrderRow[] | null) ?? []) orders.set(o.id, o);
  }

  const opportunityIds = [
    ...new Set([...orders.values()].map((o) => o.opportunity_id).filter((v): v is string => Boolean(v))),
  ];
  const opportunities = new Map<string, OpportunityRow>();
  if (opportunityIds.length) {
    const { data: opRows } = await db.from("opportunities").select("*").in("id", opportunityIds);
    for (const o of (opRows as OpportunityRow[] | null) ?? []) opportunities.set(o.id, o);
  }

  const rows: DecisionOutcome[] = [];
  let unmatched = 0;

  for (const sale of sales) {
    const position = positions.get(sale.position_id);
    const order = position?.order_id ? orders.get(position.order_id) : undefined;
    const op = order?.opportunity_id ? opportunities.get(order.opportunity_id) : undefined;
    if (!op) {
      unmatched += 1;
      continue;
    }

    rows.push({
      asin: sale.asin,
      title: sale.products?.title ?? sale.asin,
      judgment: op.judgment ?? null,
      pattern: op.pattern,
      confidence: Number(op.confidence),
      predictedProfit: Number(op.net_profit) * sale.qty,
      predictedDays: Number(op.expected_days),
      realizedProfit: Number(sale.realized_profit),
      realizedDays: Number(sale.holding_days),
    });
  }

  return { result: analyzePrecision(rows), rows, unmatched };
}
