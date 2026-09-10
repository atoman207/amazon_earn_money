import { NextResponse } from "next/server";
import { audit } from "@/lib/server/settings";
import { scanUniverse } from "@/lib/server/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("key") === secret;
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  const summary = await scanUniverse();
  await audit("cron", "scan", null, summary as unknown as Record<string, unknown>);
  return NextResponse.json({
    ok: true,
    scanned: summary.scanned,
    created: summary.created,
    passed: summary.passed,
  });
}

export const GET = run;
export const POST = run;
