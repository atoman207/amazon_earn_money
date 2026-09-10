import { NextResponse } from "next/server";
import { audit } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** 監視リストの状態更新（R01） */
export async function POST(req: Request) {
  const form = await req.formData();
  const asin = String(form.get("asin") ?? "").trim();
  const status = String(form.get("status") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim() || null;
  const allowed = ["candidate", "review", "watching", "paused", "ended"];

  if (!asin || !allowed.includes(status)) {
    return NextResponse.json({ error: "不正な入力" }, { status: 400 });
  }
  if (status === "watching" && !reason) {
    return NextResponse.redirect(new URL("/inventory/monitor?err=reason", req.url), 303);
  }

  const { error } = await supabaseAdmin()
    .from("watch_universe")
    .update({
      status,
      reason,
      active: status === "watching" || status === "review",
      review_by:
        status === "watching" || status === "review"
          ? new Date(Date.now() + 14 * 86_400_000).toISOString()
          : null,
    } as never)
    .eq("asin", asin);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit("user", "watch_status", asin, { status, reason });
  return NextResponse.redirect(new URL("/inventory/monitor", req.url), 303);
}
