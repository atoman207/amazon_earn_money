import "server-only";
import { getSessionStatus } from "@/lib/server/amazon/session";
import { listCartItems } from "@/lib/server/cart";
import { collectorStatuses, type CollectorStatus } from "@/lib/server/collector";
import { latestScan } from "@/lib/server/discountScan";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DiscountProductRow, DiscountScanRow } from "@/lib/supabase/database.types";

/**
 * ダッシュボードが「いまどうなっているか」を出すために集める材料。
 *
 * 数字だけでなく、次に何をすればよいかを判断できる材料を並べる：
 *   - 直近の割引検索は成功したのか、何件見つかったのか
 *   - その中で今いちばん割引率が高いのはどれか
 *   - 自分のカートに何が残っているか
 *   - Amazonのセッションは生きているか（切れていると何も取れない）
 */

export interface DiscountSnapshot {
  scan: DiscountScanRow | null;
  /** 直近スキャンの上位（割引率順） */
  top: DiscountProductRow[];
  /** 直近スキャンで保存された件数 */
  count: number;
  /** 20%以上で拾えている件数。狙い目がどれだけあるかの目安 */
  strongCount: number;
  maxRate: number | null;
}

export interface CartSnapshot {
  count: number;
  totalSaving: number;
  maxRate: number | null;
  latestAddedAt: string | null;
}

export interface SessionSnapshot {
  exists: boolean;
  loggedIn: boolean | null;
  isBusiness: boolean | null;
  accountLabel: string | null;
  savedAt: string | null;
}

export interface OperationSnapshot {
  discount: DiscountSnapshot;
  cart: CartSnapshot;
  session: SessionSnapshot;
  watchCount: number;
  /** 価格収集の状態。ここが止まっていると③⑥⑦が動かない。 */
  collectors: CollectorStatus[];
  /** 直近24時間に入った価格観測の件数 */
  observationsToday: number;
}

const STRONG_RATE = 20;

async function discountSnapshot(): Promise<DiscountSnapshot> {
  const scan = await latestScan();
  if (!scan) return { scan: null, top: [], count: 0, strongCount: 0, maxRate: null };

  const db = supabaseAdmin();
  const [{ data: top }, { count }, { count: strong }] = await Promise.all([
    db
      .from("discount_products")
      .select("*")
      .eq("scan_id", scan.id)
      .order("discount_rate", { ascending: false, nullsFirst: false })
      .limit(5),
    db.from("discount_products").select("id", { count: "exact", head: true }).eq("scan_id", scan.id),
    db
      .from("discount_products")
      .select("id", { count: "exact", head: true })
      .eq("scan_id", scan.id)
      .gte("discount_rate", STRONG_RATE),
  ]);

  const rows = (top as DiscountProductRow[] | null) ?? [];
  return {
    scan,
    top: rows,
    count: count ?? 0,
    strongCount: strong ?? 0,
    maxRate: rows[0]?.discount_rate ?? null,
  };
}

async function cartSnapshot(userId: string): Promise<CartSnapshot> {
  const items = await listCartItems(userId);
  const rates = items
    .map((i) => i.discount_rate)
    .filter((r): r is number => r != null && Number.isFinite(r));

  return {
    count: items.length,
    totalSaving: items.reduce((sum, i) => sum + (i.discount_amount ?? 0), 0),
    maxRate: rates.length ? Math.max(...rates) : null,
    latestAddedAt: items[0]?.added_at ?? null,
  };
}

async function sessionSnapshot(): Promise<SessionSnapshot> {
  try {
    const status = await getSessionStatus();
    return {
      exists: status.exists,
      loggedIn: status.loggedIn,
      isBusiness: status.isBusiness ?? status.isBusinessFromFile,
      accountLabel: status.accountLabel,
      savedAt: status.savedFileAt,
    };
  } catch {
    return { exists: false, loggedIn: null, isBusiness: null, accountLabel: null, savedAt: null };
  }
}

export async function operationSnapshot(userId: string): Promise<OperationSnapshot> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 86_400_000).toISOString();

  const [{ count: watchCount }, { count: observationsToday }] = await Promise.all([
    db.from("watch_universe").select("asin", { count: "exact", head: true }).eq("active", true),
    db
      .from("price_observations")
      .select("id", { count: "exact", head: true })
      .gte("observed_at", since),
  ]);

  const [discount, cart, session] = await Promise.all([
    discountSnapshot(),
    cartSnapshot(userId),
    sessionSnapshot(),
  ]);

  return {
    discount,
    cart,
    session,
    watchCount: watchCount ?? 0,
    collectors: collectorStatuses(),
    observationsToday: observationsToday ?? 0,
  };
}

export interface NextStep {
  label: string;
  href: string;
  done: boolean;
}

/**
 * 「次にやること」。上から順に、まだ済んでいないものが実際の次の一手になる。
 * 空の画面を見せられても困るので、手順として示す。
 */
export function nextSteps(snapshot: OperationSnapshot): NextStep[] {
  return [
    {
      label: "Amazonビジネスにログインしてセッションを保存する",
      href: "/settings",
      done: snapshot.session.exists && snapshot.session.loggedIn !== false,
    },
    {
      label: "価格収集（Keepa）の鍵を設定して、値動きを追えるようにする",
      href: "/settings",
      done: snapshot.collectors.some((c) => c.name === "keepa" && c.configured),
    },
    {
      label: "割引検索でカテゴリと割引率を選んで実行する",
      href: "/collect/amazon",
      done: snapshot.discount.count > 0,
    },
    {
      label: "良さそうな商品をカートに入れる",
      href: "/collect/amazon",
      done: snapshot.cart.count > 0,
    },
    {
      label: "監視リストに入れて値動きを追う",
      href: "/inventory/monitor",
      done: snapshot.watchCount > 0,
    },
  ];
}
