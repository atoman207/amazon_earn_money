import { NextResponse } from "next/server";
import { audit, loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { holdingDays } from "@/lib/format";

export const dynamic = "force-dynamic";

/** 失敗の原因として受け付ける値（スキーマの check と揃える） */
const FAILURE_CODES = [
  "price_drop",
  "competition",
  "slow_sales",
  "fee_miss",
  "demand_gone",
  "other",
];

/** 売却の記録。手数料を差し引いた確定純利益を計算して保存する。 */
export async function POST(req: Request, { params }: RouteContext<"/api/positions/[id]/sell">) {
  const { id } = await params;
  const form = await req.formData();
  const sellPrice = Number(form.get("sellPrice"));
  const db = supabaseAdmin();

  const { data: pos } = await db.from("positions").select("*, products(*)").eq("id", id).maybeSingle();
  if (!pos) return NextResponse.json({ error: "在庫が見つかりません" }, { status: 404 });

  const qty = Math.max(1, Math.min(Number(form.get("qty") ?? pos.qty) || pos.qty, pos.qty));
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
    return NextResponse.json({ error: "売却価格が不正です" }, { status: 400 });
  }

  const settings = await loadSettings();
  const product = (pos as unknown as { products: { referral_fee_rate: number; size_tier: keyof typeof settings.costs.fbaFeeByTier } | null })
    .products;

  const held = holdingDays(pos.opened_at);
  const referral = Math.round(sellPrice * (product?.referral_fee_rate ?? 0.1));
  const fba = settings.costs.fbaFeeByTier[product?.size_tier ?? "standard"];
  const storage = Math.round(held * settings.costs.storageFeePerDay);
  const returns = Math.round(sellPrice * settings.costs.returnsRate);
  const feesPerUnit = referral + fba + storage + returns;
  const profitPerUnit = sellPrice - feesPerUnit - Number(pos.acquisition_cost);

  // 損になったときだけ原因を残す（⑧ 次回の判断を良くするための材料）
  const rawCode = String(form.get("failureReasonCode") ?? "").trim();
  const failureCode = FAILURE_CODES.includes(rawCode) && profitPerUnit < 0 ? rawCode : null;
  const note = String(form.get("note") ?? "").trim() || null;

  const saleRow = {
    position_id: id,
    asin: pos.asin,
    qty,
    sell_price: sellPrice,
    fees: feesPerUnit * qty,
    realized_profit: profitPerUnit * qty,
    holding_days: held,
    exit_rule: (String(form.get("exitRule") ?? "").trim() || null) as string | null,
    failure_reason_code: failureCode,
    note,
  };

  let { error: sErr } = await db.from("sales").insert(saleRow as never);
  // 列がまだ無いDBでも、売却の記録そのものは残す（原因とメモだけ落とす）
  if (sErr && /failure_reason_code|note|schema cache|column/i.test(sErr.message)) {
    const legacy = { ...saleRow };
    delete (legacy as Partial<typeof saleRow>).failure_reason_code;
    delete (legacy as Partial<typeof saleRow>).note;
    ({ error: sErr } = await db.from("sales").insert(legacy as never));
  }
  if (sErr) return NextResponse.json({ error: `売却の記録に失敗: ${sErr.message}` }, { status: 500 });

  const remaining = pos.qty - qty;
  if (remaining > 0) {
    await db.from("positions").update({ qty: remaining }).eq("id", id);
  } else {
    await db
      .from("positions")
      .update({
        status: profitPerUnit >= 0 ? "sold" : "stopped",
        closed_at: new Date().toISOString(),
      })
      .eq("id", id);
    await db.from("exit_signals").update({ resolved: true }).eq("position_id", id);
  }

  await audit("user", "record_sale", id, { qty, sellPrice, profit: profitPerUnit * qty });
  return NextResponse.redirect(new URL("/review/summary", req.url), 303);
}
