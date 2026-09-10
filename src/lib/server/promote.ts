import "server-only";
import { ingestAndEvaluate } from "@/lib/server/pipeline";
import { audit, loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CartItemRow, DiscountScanRow, OpportunityRow } from "@/lib/supabase/database.types";

/**
 * 割引検索で見つけた商品を、採算判定のパイプラインへ載せる。
 *
 * ここが無いと「安く買えるものを探す」機能と「利益が出るか判定する」機能が
 * 分断されたままになる。カートに入れた＝検討対象なので、その時点で
 *   商品マスタ（products） → 監視リスト（watch_universe） → 価格観測（price_observations）
 * まで作り、そのまま利益計算まで走らせる。
 *
 * 気をつけていること：
 *  - 出品できるかは未確認なので listing_gate は UNKNOWN にする（＝そのままでは購入承認できない）
 *  - 販売価格は「参考価格（個人向けの取り消し線価格）」しか無く、実際の相場ではない。
 *    競合数も販売ランキングも取れていないため、初回の判定は必ず信頼度が低く出る。
 *    これは欠陥ではなく、材料が足りないことを正しく表している。
 */

export interface PromoteResult {
  asin: string;
  name: string;
  /** 商品マスタを新しく作ったか */
  productCreated: boolean;
  /** 採算判定まで進めたか */
  evaluated: boolean;
  /** 進めなかった理由（重複検知・価格欠落など） */
  reason?: string;
  opportunityId?: string;
  netProfit?: number;
  roi?: number;
  passed?: boolean;
}

/** 割引スキャンのカテゴリ名を商品マスタのカテゴリに使う。無ければ未分類。 */
async function categoryForScan(scanId: string | null): Promise<string> {
  if (!scanId) return "未分類";
  const { data } = await supabaseAdmin()
    .from("discount_scans")
    .select("category_labels")
    .eq("id", scanId)
    .maybeSingle();
  const labels = (data as Pick<DiscountScanRow, "category_labels"> | null)?.category_labels ?? [];
  return labels[0] ?? "未分類";
}

/** 商品マスタに無ければ作る。すでにあるものは触らない（手で直した内容を消さない）。 */
async function ensureProduct(item: CartItemRow, category: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("products")
    .select("asin")
    .eq("asin", item.asin)
    .maybeSingle();
  if (existing) return false;

  const { error } = await db.from("products").insert({
    asin: item.asin,
    title: item.name,
    category,
    image_url: item.image_url,
    // 出品できるかは未確認。UNKNOWN のままでは購入承認できない。
    listing_gate: "UNKNOWN",
  } as never);
  if (error) throw new Error(`商品マスタに登録できませんでした: ${error.message}`);
  return true;
}

/** 監視リストへ入れる。すでにあれば有効化だけする。 */
async function ensureWatch(asin: string) {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("watch_universe")
    .select("asin")
    .eq("asin", asin)
    .maybeSingle();

  if (existing) {
    await db.from("watch_universe").update({ active: true } as never).eq("asin", asin);
    return;
  }

  const { error } = await db.from("watch_universe").insert({
    asin,
    tier: "B",
    priority: 1,
    active: true,
    status: "candidate",
    reason: "割引検索で見つけてカートに入れた",
  } as never);
  // status 等の列が無い古いDBでも最低限は登録する
  if (error) {
    await db.from("watch_universe").insert({ asin, tier: "B", priority: 1, active: true } as never);
  }
}

/**
 * カートの1件をパイプラインへ載せる。
 * 仕入価格＝数量別のビジネス価格、販売価格の当たり＝参考価格。
 */
export async function promoteCartItem(item: CartItemRow): Promise<PromoteResult> {
  const base: PromoteResult = {
    asin: item.asin,
    name: item.name,
    productCreated: false,
    evaluated: false,
  };

  if (item.unit_price == null || item.unit_price <= 0) {
    return { ...base, reason: "ビジネス価格が取れていないため判定できません" };
  }
  if (item.reference_price == null || item.reference_price <= 0) {
    return { ...base, reason: "参考価格が取れていないため販売価格を置けません" };
  }

  const category = await categoryForScan(item.scan_id);
  const productCreated = await ensureProduct(item, category);
  await ensureWatch(item.asin);

  const settings = await loadSettings();
  const result = await ingestAndEvaluate(
    {
      asin: item.asin,
      buyPrice: item.unit_price,
      // 参考価格は「個人向けの取り消し線価格」。相場そのものではないので、
      // これを販売価格の当たりとして置き、実測が入るたびに置き換わっていく。
      sellPrice: item.reference_price,
      offerCount: null,
      salesRank: null,
      inStock: true,
      source: "discount-scan",
    },
    settings,
  );

  if (!result.created) {
    return { ...base, productCreated, reason: result.reason };
  }

  await audit("user", "promote_cart_item", item.asin, {
    opportunityId: result.opportunityId,
    netProfit: result.netProfit,
    passed: result.passed,
  });

  return {
    ...base,
    productCreated,
    evaluated: true,
    opportunityId: result.opportunityId,
    netProfit: result.netProfit,
    passed: result.passed,
  };
}

/** カートの中身をまとめて判定する */
export async function promoteCartItems(items: CartItemRow[]): Promise<PromoteResult[]> {
  const results: PromoteResult[] = [];
  for (const item of items) {
    const r = await promoteCartItem(item).catch((err: unknown) => ({
      asin: item.asin,
      name: item.name,
      productCreated: false,
      evaluated: false,
      reason: err instanceof Error ? err.message : String(err),
    }));
    results.push(r);
  }
  return results;
}

/** 画面に判定結果を出すため、ASIN ごとの直近の機会を引く */
export async function latestOpportunityByAsin(
  asins: string[],
): Promise<Map<string, OpportunityRow>> {
  const out = new Map<string, OpportunityRow>();
  if (asins.length === 0) return out;

  const { data } = await supabaseAdmin()
    .from("opportunities")
    .select("*")
    .in("asin", asins)
    .order("detected_at", { ascending: false })
    .limit(500);

  for (const row of (data as OpportunityRow[] | null) ?? []) {
    if (!out.has(row.asin)) out.set(row.asin, row);
  }
  return out;
}
