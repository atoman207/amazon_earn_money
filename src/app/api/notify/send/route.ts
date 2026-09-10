import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { readForm } from "@/lib/server/form";
import { audit } from "@/lib/server/settings";
import { dispatchNotifications } from "@/lib/server/steps/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 画面の「いま送る」から呼ぶ通知（④-1）。
 *
 * 静穏時間帯は既定で送らない。押し切る場合は force=1 を明示させ、
 * 誰がいつ押し切ったかを監査ログに残す。
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const form = await readForm(req);
  const force = String(form.get("force") ?? "") === "1";

  const result = await dispatchNotifications({ force });
  await audit(user.email, "notify_send", null, {
    force,
    sent: result.sent,
    skipped: result.skipped,
    errors: result.errors,
  });

  const url = new URL("/notify/queue", req.url);
  if (result.skipped) url.searchParams.set("skipped", result.skipped);
  else url.searchParams.set("sent", String(result.sent));
  return NextResponse.redirect(url, 303);
}
