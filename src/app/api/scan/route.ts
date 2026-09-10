import { NextResponse } from "next/server";
import { audit } from "@/lib/server/settings";
import { scanUniverse } from "@/lib/server/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const summary = await scanUniverse();
  await audit("user", "scan", null, {
    scanned: summary.scanned,
    created: summary.created,
    passed: summary.passed,
  });
  return NextResponse.redirect(new URL("/purchase/approve", req.url), 303);
}
