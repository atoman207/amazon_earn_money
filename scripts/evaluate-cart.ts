import "./load-env";
import { promoteCartItems } from "../src/lib/server/promote";
import { supabaseAdmin } from "../src/lib/supabase/admin";
import type { CartItemRow } from "../src/lib/supabase/database.types";

/**
 * カートに入っている商品を採算判定のパイプラインへ載せる。
 *   npm run cart:evaluate            … 全利用者ぶん
 *   npm run cart:evaluate -- <メール> … その利用者ぶんだけ
 *
 * 画面の「採算を判定する」と同じ処理を、まとめて流すためのもの。
 */
async function main() {
  const email = process.argv[2];
  const db = supabaseAdmin();

  let userId: string | null = null;
  if (email) {
    const { data } = await db.from("app_users").select("id,email").ilike("email", email).maybeSingle();
    if (!data) {
      console.error(`利用者 ${email} が見つかりません`);
      process.exitCode = 1;
      return;
    }
    userId = (data as { id: string }).id;
  }

  let query = db.from("cart_items").select("*").order("added_at", { ascending: true });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;

  if (error) {
    console.error(`カートを読めませんでした: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const items = (data as CartItemRow[] | null) ?? [];
  if (items.length === 0) {
    console.log("カートは空です。");
    return;
  }

  console.log(`${items.length}件を判定します…`);
  const results = await promoteCartItems(items);

  for (const r of results) {
    const name = r.name.length > 32 ? `${r.name.slice(0, 32)}…` : r.name;
    if (r.evaluated) {
      console.log(
        `  ✔ ${r.asin} ${name} 利益${Math.round(r.netProfit ?? 0)}円 ${r.passed ? "通過" : "非通過"}`,
      );
    } else {
      console.log(`  – ${r.asin} ${name} : ${r.reason ?? "判定できませんでした"}`);
    }
  }

  const evaluated = results.filter((r) => r.evaluated).length;
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n判定 ${evaluated}/${results.length}件、条件を満たしたもの ${passed}件`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
