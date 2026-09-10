import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/server/settings";
import { buildFlexMessage, inQuietHours, sendLineNotification } from "@/lib/server/line";
import type { OpportunityRow, ProductRow } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}` || new URL(req.url).searchParams.get("key") === secret;
}

/** 上位N件をLINEへ配信する。静穏時間帯・1日の上限・重複を守る。 */
async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "権限がありません" }, { status: 401 });

  const db = supabaseAdmin();
  const settings = await loadSettings();

  if (inQuietHours(new Date(), settings.notify.quietStartHour, settings.notify.quietEndHour)) {
    return NextResponse.json({ ok: true, skipped: "静穏時間帯" });
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count: sentToday } = await db
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .gte("sent_at", dayStart.toISOString());

  const remaining = Math.max(0, settings.notify.dailyLimit - (sentToday ?? 0));
  if (remaining === 0) return NextResponse.json({ ok: true, skipped: "1日の上限に到達" });

  const { data: candidates } = await db
    .from("opportunities")
    .select("*, products(*)")
    .eq("status", "pending")
    .eq("passed", true)
    .order("score", { ascending: false })
    .limit(Math.min(settings.notify.topN, remaining));

  const sent: string[] = [];
  for (const c of (candidates ?? []) as unknown as Array<OpportunityRow & { products: ProductRow }>) {
    const { data: already } = await db
      .from("notifications")
      .select("id")
      .eq("opportunity_id", c.id)
      .limit(1);
    if (already?.length) continue;

    await sendLineNotification(c.id, buildFlexMessage(c, c.products));
    sent.push(c.id);
  }

  return NextResponse.json({ ok: true, sent: sent.length, ids: sent });
}

export const GET = run;
export const POST = run;
