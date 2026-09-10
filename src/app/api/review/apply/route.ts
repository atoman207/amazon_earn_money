import { NextResponse } from "next/server";
import type { ThresholdSettings } from "@/lib/domain/types";
import { currentUser } from "@/lib/server/auth";
import { readForm } from "@/lib/server/form";
import { audit, loadSettings, saveSetting } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 変更してよい閾値（提案から来たものだけを受け付ける） */
const ALLOWED: Array<keyof ThresholdSettings> = [
  "minNetProfit",
  "minRoi",
  "maxExpectedDays",
  "minConfidence",
  "stopLossRate",
  "timeStopDays",
  "forceSellDays",
  "trailingDrop",
  "storageRatioCap",
];

/**
 * ⑧-3 の提案を1つだけ設定へ反映する。
 *
 * 自動では変えない。押した人・変える前の値・変えた後の値を監査ログに残し、
 * あとから「なぜこの設定になっているのか」をたどれるようにする。
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const form = await readForm(req);
  const key = String(form.get("key") ?? "") as keyof ThresholdSettings;
  const value = Number(form.get("value"));

  if (!ALLOWED.includes(key) || !Number.isFinite(value)) {
    return NextResponse.json({ error: "受け付けられない変更です" }, { status: 400 });
  }

  const cur = await loadSettings();
  const before = cur.thresholds[key];
  await saveSetting("thresholds", { ...cur.thresholds, [key]: value });
  await audit(user.email, "apply_threshold_suggestion", key, { before, after: value });

  return NextResponse.redirect(new URL("/review/logic?applied=1", req.url), 303);
}
