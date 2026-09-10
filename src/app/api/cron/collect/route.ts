import { NextResponse } from "next/server";
import { collectWatched } from "@/lib/server/collector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Hobby の関数上限は 60 秒。Pro（最大 300 秒）へ移ったら引き上げてよい。
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}` || new URL(req.url).searchParams.get("key") === secret;
}

/**
 * 監視銘柄の価格を取りに行き、そのまま採算判定まで流す（① データ収集）。
 * 収集元の鍵が無ければ、取らずに理由だけ返す。
 */
async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "権限がありません" }, { status: 401 });

  const result = await collectWatched();
  return NextResponse.json({
    ok: result.configured,
    ...result,
    // 鍵が無いときは 200 で返しつつ、ok:false で気付けるようにする
    hint: result.configured
      ? undefined
      : "KEEPA_API_KEY を .env.local に設定してください（未設定のあいだ価格は取得されません）",
  });
}

export const GET = run;
export const POST = run;
