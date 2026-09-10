import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ingestAndEvaluate } from "@/lib/server/pipeline";
import { loadSettings } from "@/lib/server/settings";

/**
 * 監視対象の最新価格を読み直して、いま値引きになっている商品を候補にする。
 * 実運用では Collector が価格を書き込み、ここが評価だけを担う。
 */
export async function scanUniverse(limit = 200) {
  const db = supabaseAdmin();
  const settings = await loadSettings();

  const { data: watch } = await db
    .from("watch_universe")
    .select("asin")
    .eq("active", true)
    .order("priority", { ascending: false })
    .limit(limit);

  // status カラムがある場合は監視中・要確認を優先（無い環境では active のみ）
  // PostgREST は未知カラムをエラーにするため、ここでは active で絞る。

  const results = [];
  for (const w of watch ?? []) {
    // その商品の最新観測を「いまの価格」として評価する
    const { data: latest } = await db
      .from("price_observations")
      .select("*")
      .eq("asin", w.asin)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) continue;

    const r = await ingestAndEvaluate(
      {
        asin: w.asin,
        buyPrice: latest.buy_price,
        sellPrice: latest.sell_price,
        offerCount: latest.offer_count,
        salesRank: latest.sales_rank,
        inStock: latest.in_stock,
        source: "scan",
      },
      settings,
    );
    results.push(r);
  }

  const created = results.filter((r) => r.created);
  return {
    scanned: results.length,
    created: created.length,
    passed: created.filter((r) => r.passed).length,
    results,
  };
}
