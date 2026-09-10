import "server-only";
import { allocate, kellyFraction, type AllocationResult } from "@/lib/domain/allocation";
import type { AppSettings } from "@/lib/domain/types";
import { loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  OpportunityRow,
  OrderRow,
  PositionRow,
  PriceObservationRow,
  ProductRow,
} from "@/lib/supabase/database.types";

/**
 * ⑤ 購入承認・仕入れ。
 *
 * 承認の画面では「いま押したらどうなるか」を先に見せる。
 * 承認時の価格と今の価格がずれていれば発注は止まる仕組みなので、
 * そのズレを押す前に出しておく（押してから断られるのが一番困る）。
 */

export interface ApprovalCard {
  opportunity: OpportunityRow;
  product: ProductRow | null;
  /** いまの仕入価格 */
  currentBuyPrice: number | null;
  /** 承認時の価格からのズレ */
  drift: number | null;
  inStock: boolean | null;
  observedAt: string | null;
  /** 発注直前の再確認に通るか */
  blocked: string | null;
}

export interface ApprovalView {
  cards: ApprovalCard[];
  settings: AppSettings;
  /** 承認するとどれだけ資金を使うか */
  totalCost: number;
}

/** 承認時の価格からこれ以上ずれていたら発注を止める（api 側と同じ値） */
const MAX_DRIFT = 0.03;

export async function approvalQueue(limit = 20): Promise<ApprovalView> {
  const db = supabaseAdmin();
  const settings = await loadSettings();

  const { data } = await db
    .from("opportunities")
    .select("*, products(*)")
    .eq("status", "pending")
    .eq("passed", true)
    .order("score", { ascending: false })
    .limit(limit);

  const list = (data ?? []) as unknown as Array<OpportunityRow & { products: ProductRow | null }>;
  const cards: ApprovalCard[] = [];

  for (const op of list) {
    const { data: latest } = await db
      .from("price_observations")
      .select("buy_price, in_stock, observed_at")
      .eq("asin", op.asin)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = latest as Pick<PriceObservationRow, "buy_price" | "in_stock" | "observed_at"> | null;
    const currentBuyPrice = typeof row?.buy_price === "number" ? row.buy_price : null;
    const drift =
      currentBuyPrice && Number(op.buy_price) > 0
        ? Math.abs(currentBuyPrice - Number(op.buy_price)) / Number(op.buy_price)
        : null;

    let blocked: string | null = null;
    if (op.listing_gate && op.listing_gate !== "PASS") {
      blocked = `出品ゲートが ${op.listing_gate} のため承認できません`;
    } else if (row && row.in_stock === false) {
      blocked = "在庫切れです";
    } else if (drift !== null && drift > MAX_DRIFT) {
      blocked = `価格が ${(drift * 100).toFixed(1)}% 動いています（${(MAX_DRIFT * 100).toFixed(0)}%を超えると発注は止まります）`;
    } else if (
      op.max_buy_price != null &&
      currentBuyPrice != null &&
      currentBuyPrice > Number(op.max_buy_price)
    ) {
      blocked = `現在価格が仕入上限 ${Math.round(Number(op.max_buy_price)).toLocaleString("ja-JP")}円 を超えています`;
    }

    cards.push({
      opportunity: op,
      product: op.products,
      currentBuyPrice,
      drift,
      inStock: row?.in_stock ?? null,
      observedAt: row?.observed_at ?? null,
      blocked,
    });
  }

  return {
    cards,
    settings,
    totalCost: cards
      .filter((c) => !c.blocked)
      .reduce((a, c) => a + Number(c.opportunity.acquisition_cost) * c.opportunity.suggested_qty, 0),
  };
}

export interface QuantityRow {
  opportunity: OpportunityRow;
  product: ProductRow | null;
  allocation: AllocationResult;
  /** 資金の上限から出る数量 */
  qtyByCapital: number;
  /** 実際に推奨する数量（判定時に決まった数） */
  suggestedQty: number;
  unitCost: number;
  totalCost: number;
}

export interface QuantityView {
  rows: QuantityRow[];
  settings: AppSettings;
  capital: {
    working: number;
    reserve: number;
    investable: number;
    deployed: number;
    available: number;
    byCategory: Array<{ category: string; amount: number; cap: number }>;
  };
}

/** 購入数量の自動計算（⑤-2）。何が上限を決めたのかまで返す。 */
export async function quantityPlan(limit = 20): Promise<QuantityView> {
  const db = supabaseAdmin();
  const settings = await loadSettings();

  const [{ data: opportunities }, { data: positions }] = await Promise.all([
    db
      .from("opportunities")
      .select("*, products(*)")
      .eq("status", "pending")
      .eq("passed", true)
      .order("score", { ascending: false })
      .limit(limit),
    db.from("positions").select("qty, acquisition_cost, products(category)").in("status", ["holding", "listed"]),
  ]);

  let deployed = 0;
  const byCategory = new Map<string, number>();
  for (const p of (positions ?? []) as unknown as Array<{
    qty: number;
    acquisition_cost: number;
    products: { category: string } | null;
  }>) {
    const amount = p.qty * Number(p.acquisition_cost);
    deployed += amount;
    const c = p.products?.category ?? "未分類";
    byCategory.set(c, (byCategory.get(c) ?? 0) + amount);
  }

  const working = settings.capital.workingCapital;
  const investable = working * (1 - settings.capital.cashReserveRatio);
  const categoryCap = working * settings.capital.maxPerCategoryRatio;

  const rows: QuantityRow[] = ((opportunities ?? []) as unknown as Array<
    OpportunityRow & { products: ProductRow | null }
  >).map((op) => {
    const category = op.products?.category ?? "未分類";
    const stopLoss = Number(op.acquisition_cost) * Math.abs(settings.thresholds.stopLossRate);
    const allocation = allocate({
      capital: settings.capital,
      deployedTotal: deployed,
      deployedInCategory: byCategory.get(category) ?? 0,
      netProfit: Number(op.net_profit),
      stopLoss,
      sellProbability: Number(op.sell_probability),
    });
    const unitCost = Number(op.acquisition_cost);
    const qtyByCapital = unitCost > 0 ? Math.floor(allocation.perItemCap / unitCost) : 0;

    return {
      opportunity: op,
      product: op.products,
      allocation,
      qtyByCapital,
      suggestedQty: op.suggested_qty,
      unitCost,
      totalCost: unitCost * op.suggested_qty,
    };
  });

  return {
    rows,
    settings,
    capital: {
      working,
      reserve: working * settings.capital.cashReserveRatio,
      investable,
      deployed,
      available: Math.max(0, investable - deployed),
      byCategory: [...byCategory.entries()]
        .map(([category, amount]) => ({ category, amount, cap: categoryCap }))
        .sort((a, b) => b.amount - a.amount),
    },
  };
}

export type OrderWithProduct = OrderRow & {
  products: ProductRow | null;
  opportunities: OpportunityRow | null;
};

export interface OrderHistoryView {
  orders: OrderWithProduct[];
  positionsByOrder: Map<string, PositionRow>;
  totals: { count: number; units: number; amount: number; withEvidence: number };
}

/** 購入履歴（⑤-3）。注文番号と実支払額まで残っているかを見る。 */
export async function orderHistory(limit = 100): Promise<OrderHistoryView> {
  const db = supabaseAdmin();

  const [{ data: orders }, { data: positions }] = await Promise.all([
    db
      .from("orders")
      .select("*, products(*), opportunities(*)")
      .order("ordered_at", { ascending: false })
      .limit(limit),
    db.from("positions").select("*").limit(500),
  ]);

  const rows = (orders ?? []) as unknown as OrderWithProduct[];
  const positionsByOrder = new Map<string, PositionRow>();
  for (const p of (positions as PositionRow[] | null) ?? []) {
    if (p.order_id) positionsByOrder.set(p.order_id, p);
  }

  return {
    orders: rows,
    positionsByOrder,
    totals: {
      count: rows.length,
      units: rows.reduce((a, o) => a + o.qty, 0),
      amount: rows.reduce((a, o) => a + Number(o.actual_paid ?? o.unit_price * o.qty), 0),
      withEvidence: rows.filter((o) => o.amazon_order_id).length,
    },
  };
}

/** 資金配分の考え方を画面で説明するための計算例 */
export function kellyExample(netProfit: number, stopLoss: number, sellProbability: number) {
  return kellyFraction(netProfit, stopLoss, sellProbability);
}
