import { NextResponse } from "next/server";
import { analyzeNiche } from "@/lib/server/ai";
import { audit } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
// Vercel Hobby の関数上限は 60 秒。Pro（最大 300 秒）へ移ったら引き上げてよい。
export const maxDuration = 60;

export async function POST(req: Request) {
  const result = await analyzeNiche();
  await audit("user", "ai_niche", null, { ok: result.ok, count: result.items.length });
  return NextResponse.redirect(new URL("/review/precision", req.url), 303);
}
