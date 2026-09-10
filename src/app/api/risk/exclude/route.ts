import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { readForm } from "@/lib/server/form";
import { audit } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 商品を「買わない」側へ倒す／戻す（⑦-4）。
 *
 * 除外は出品ゲートを FAIL にして、監視も止める。
 * ゲートが PASS でないものは⑤で承認できないので、これだけで買えなくなる。
 * 元に戻せるようにしてあるのは、確認が取れたときに再開できるようにするため。
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const form = await readForm(req);
  const asin = String(form.get("asin") ?? "").trim();
  const action = String(form.get("action") ?? "exclude");
  const reason = String(form.get("reason") ?? "").trim() || null;

  if (!asin) return NextResponse.json({ error: "ASINがありません" }, { status: 400 });

  const db = supabaseAdmin();
  const excluding = action === "exclude";

  const { error } = await db
    .from("products")
    .update({
      listing_gate: excluding ? "FAIL" : "PASS",
      restricted: excluding,
      restricted_reason: excluding ? (reason ?? "リスクが高いため手動で除外") : null,
    } as never)
    .eq("asin", asin);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 監視も合わせて止める／戻す
  await db
    .from("watch_universe")
    .update({
      active: !excluding,
      status: excluding ? "ended" : "watching",
      reason: excluding ? (reason ?? "リスクが高いため除外") : "除外を解除",
    } as never)
    .eq("asin", asin);

  // 判定待ちの候補も落とす（除外したのに通知が飛ばないように）
  if (excluding) {
    await db
      .from("opportunities")
      .update({
        status: "skipped",
        decided_at: new Date().toISOString(),
        skip_reason: reason ?? "リスクが高いため除外",
        skip_reason_code: "restriction",
        judgment: "skip",
      } as never)
      .eq("asin", asin)
      .eq("status", "pending");
  }

  await audit(user.email, excluding ? "exclude_product" : "include_product", asin, { reason });
  return NextResponse.redirect(new URL("/risk/exclude", req.url), 303);
}
