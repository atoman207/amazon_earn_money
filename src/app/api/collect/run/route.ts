import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { collectWatched } from "@/lib/server/collector";
import { audit } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 画面の「いま取り込む」から呼ぶ収集（①-2）。
 *
 * cron 用の /api/cron/collect は CRON_SECRET を要求するが、こちらはログイン済みの
 * 利用者だけが押せる。押した人を監査ログに残す。
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const result = await collectWatched();
  await audit(user.email, "collect_run", null, {
    configured: result.configured,
    attempted: result.attempted,
    collected: result.collected,
    evaluated: result.evaluated,
  });

  return NextResponse.redirect(new URL("/collect/keepa", req.url), 303);
}
