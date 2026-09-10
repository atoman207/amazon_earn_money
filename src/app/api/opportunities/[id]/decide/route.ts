import { NextResponse } from "next/server";
import { audit, loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * 通知の「購入する」「見送る」を受け取る（提案書 3.4節 モードB：承認購入）。
 * 承認された場合は、発注記録とポジションを作る。
 */
export async function POST(req: Request, { params }: RouteContext<"/api/opportunities/[id]/decide">) {
  const { id } = await params;
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const db = supabaseAdmin();

  const { data: op } = await db.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (!op) return NextResponse.json({ error: "候補が見つかりません" }, { status: 404 });
  if (op.status !== "pending") {
    return NextResponse.redirect(new URL("/purchase/approve", req.url), 303);
  }

  if (action === "skip") {
    const code = String(form.get("skipReasonCode") ?? "other");
    const reasonLabels: Record<string, string> = {
      price_change: "価格変化",
      profit_low: "利益不足",
      competition: "競合",
      evidence_weak: "販売根拠不足",
      restriction: "制限・証憑",
      capital: "資金不足",
      mismatch: "商品不一致",
      other: "その他",
    };
    const note = String(form.get("reason") ?? "").trim();
    const skip_reason = note || reasonLabels[code] || "手動で見送り";
    await db
      .from("opportunities")
      .update({
        status: "skipped",
        decided_at: new Date().toISOString(),
        skip_reason,
        skip_reason_code: code,
        judgment: "skip",
      })
      .eq("id", id);
    await audit("user", "skip_opportunity", id, { code, skip_reason });
    return NextResponse.redirect(new URL("/purchase/approve", req.url), 303);
  }

  if (action !== "approve") {
    return NextResponse.json({ error: "不明な操作" }, { status: 400 });
  }

  const settings = await loadSettings();
  const qty = Math.max(1, Math.min(Number(form.get("qty") ?? op.suggested_qty) || 1, op.suggested_qty || 1));

  // 出品ゲート未通過は承認不可
  if (op.listing_gate && op.listing_gate !== "PASS") {
    await db
      .from("opportunities")
      .update({
        status: "expired",
        decided_at: new Date().toISOString(),
        skip_reason: `出品ゲート ${op.listing_gate} のため承認不可`,
        skip_reason_code: "restriction",
      })
      .eq("id", id);
    await audit("user", "approve_failed", id, { reason: "listing_gate", gate: op.listing_gate });
    return NextResponse.redirect(new URL("/purchase/approve?err=gate", req.url), 303);
  }

  // 発注直前に価格を再確認する。承認時から離れていたら中止する（提案書の安全装置）
  const { data: latest } = await db
    .from("price_observations")
    .select("buy_price, in_stock")
    .eq("asin", op.asin)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentBuy = latest?.buy_price ?? null;
  const drift =
    currentBuy && op.buy_price ? Math.abs(currentBuy - Number(op.buy_price)) / Number(op.buy_price) : 0;

  if (latest && latest.in_stock === false) {
    await db
      .from("opportunities")
      .update({ status: "expired", decided_at: new Date().toISOString(), skip_reason: "在庫切れ" })
      .eq("id", id);
    await audit("user", "approve_failed", id, { reason: "在庫切れ" });
    return NextResponse.redirect(new URL("/purchase/approve?err=stock", req.url), 303);
  }

  if (drift > 0.03) {
    await db
      .from("opportunities")
      .update({
        status: "expired",
        decided_at: new Date().toISOString(),
        skip_reason: `価格が${(drift * 100).toFixed(1)}%変動したため中止`,
        skip_reason_code: "price_change",
      })
      .eq("id", id);
    await audit("user", "approve_failed", id, { reason: "価格変動", drift });
    return NextResponse.redirect(new URL("/purchase/approve?err=drift", req.url), 303);
  }

  // 仕入上限を超えていれば失効
  if (op.max_buy_price != null && currentBuy != null && currentBuy > Number(op.max_buy_price)) {
    await db
      .from("opportunities")
      .update({
        status: "expired",
        decided_at: new Date().toISOString(),
        skip_reason: `現在価格が仕入上限 ${op.max_buy_price}円 を超過`,
        skip_reason_code: "price_change",
      })
      .eq("id", id);
    await audit("user", "approve_failed", id, { reason: "max_buy_price" });
    return NextResponse.redirect(new URL("/purchase/approve?err=maxbuy", req.url), 303);
  }

  const unitPrice = currentBuy ?? Number(op.buy_price);
  const acquisitionCost = Number(op.acquisition_cost);
  const amazonOrderId = String(form.get("amazonOrderId") ?? "").trim() || null;
  const actualPaidRaw = Number(form.get("actualPaid"));
  const actualPaid = Number.isFinite(actualPaidRaw) && actualPaidRaw > 0 ? actualPaidRaw : null;

  const { data: order, error: oErr } = await db
    .from("orders")
    .insert({
      opportunity_id: id,
      asin: op.asin,
      qty,
      unit_price: unitPrice,
      acquisition_cost: acquisitionCost,
      mode: settings.operation.purchaseMode,
      status: "placed",
      amazon_order_id: amazonOrderId,
      actual_paid: actualPaid,
    })
    .select("id")
    .single();

  if (oErr) return NextResponse.json({ error: `発注に失敗: ${oErr.message}` }, { status: 500 });

  const { error: pErr } = await db.from("positions").insert({
    order_id: (order as { id: string }).id,
    asin: op.asin,
    qty,
    acquisition_cost: acquisitionCost,
    target_price: Number(op.expected_sell_price),
    stop_price: Math.round(acquisitionCost * (1 + settings.thresholds.stopLossRate)),
    peak_price: Number(op.expected_sell_price),
    status: "holding",
  });
  if (pErr) return NextResponse.json({ error: `在庫登録に失敗: ${pErr.message}` }, { status: 500 });

  await db
    .from("opportunities")
    .update({ status: "ordered", decided_at: new Date().toISOString() })
    .eq("id", id);
  await audit("user", "approve_opportunity", id, { qty, unitPrice });

  return NextResponse.redirect(new URL("/inventory/monitor", req.url), 303);
}
