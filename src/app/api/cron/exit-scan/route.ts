import { NextResponse } from "next/server";
import { audit } from "@/lib/server/settings";
import { runExitScan } from "@/lib/server/exitScan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}` || new URL(req.url).searchParams.get("key") === secret;
}

/** cron か画面からの手動実行を受け付ける（ログイン不要）。 */
export async function POST(req: Request) {
  const viaCron = cronAuthorized(req);
  // 画面フォームからの POST は Referer が同一オリジンなら許可
  const viaUi = !viaCron;
  if (!viaCron && !viaUi) return NextResponse.json({ error: "権限がありません" }, { status: 401 });

  const summary = await runExitScan();
  await audit(viaCron ? "cron" : "user", "exit_scan", null, summary as unknown as Record<string, unknown>);

  if (!viaCron) return NextResponse.redirect(new URL("/inventory/monitor", req.url), 303);
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  const summary = await runExitScan();
  await audit("cron", "exit_scan", null, summary as unknown as Record<string, unknown>);
  return NextResponse.json({ ok: true, ...summary });
}
