import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { yen, pct, days, stars } from "@/lib/format";
import type { OpportunityRow, ProductRow } from "@/lib/supabase/database.types";

/**
 * LINE 通知。トークンが未設定でもエラーにはせず、通知履歴だけ残す。
 * （提案書 3.3節の通知カードと同じ項目を並べる）
 */
export function buildFlexMessage(op: OpportunityRow, product: ProductRow) {
  const title = product.title.length > 38 ? `${product.title.slice(0, 38)}…` : product.title;
  const row = (label: string, value: string, note = "") =>
    `${label}：${value}${note ? `（${note}）` : ""}`;

  const judgment =
    op.judgment === "pilot"
      ? "少量検証候補"
      : op.judgment === "review"
        ? "要確認"
        : op.judgment === "skip"
          ? "見送り"
          : "購入候補";

  const lines = [
    `【${judgment}｜利益 ${yen(op.net_profit)} / ROI ${pct(op.roi)} / ${days(op.expected_days)}】`,
    title,
    `ASIN：${op.asin}`,
    row("仕入価格", yen(op.buy_price), op.max_buy_price != null ? `上限 ${yen(op.max_buy_price)}` : ""),
    row("想定販売価格", yen(op.expected_sell_price)),
    row("推奨数量", `${op.suggested_qty}個`),
    row(
      "手数料など",
      `−${yen(op.referral_fee + op.fba_fee + op.storage_fee + op.returns_allowance - op.points_back)}`,
      `ポイント還元 +${yen(op.points_back)} 差引後`,
    ),
    row("データの信頼度", stars(op.confidence)),
    op.listing_gate && op.listing_gate !== "PASS" ? `出品ゲート：${op.listing_gate}` : "",
    op.warnings.length ? `注意：${op.warnings.join(" / ")}` : "注意事項：なし",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function sendLineNotification(
  opportunityId: string,
  text: string,
): Promise<{ delivered: boolean; error: string | null }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TO_USER_ID;

  let delivered = false;
  let error: string | null = null;

  if (!token || !to) {
    error = "LINE未設定（履歴のみ記録）";
  } else {
    try {
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      });
      delivered = res.ok;
      if (!res.ok) error = `LINE APIエラー ${res.status}: ${await res.text()}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  await supabaseAdmin().from("notifications").insert({
    opportunity_id: opportunityId,
    channel: "line",
    payload: { text } as never,
    delivered,
    error,
  });

  return { delivered, error };
}

/** 静穏時間帯の判定（提案書 3.3節） */
export function inQuietHours(now: Date, startHour: number, endHour: number): boolean {
  const h = now.getHours();
  return startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}
