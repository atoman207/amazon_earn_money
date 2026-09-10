import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { readForm } from "@/lib/server/form";
import { audit, loadSettings, saveSetting } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const num = (form: FormData, key: string, fallback: number) => {
  const v = Number(form.get(key));
  return Number.isFinite(v) ? v : fallback;
};

const clampHour = (n: number) => Math.min(23, Math.max(0, Math.round(n)));

/** 通知の設定だけを保存する（④-3）。他の設定には触れない。 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const form = await readForm(req);
  const cur = await loadSettings();

  await saveSetting("notify", {
    ...cur.notify,
    intervalMinutes: Math.max(1, num(form, "intervalMinutes", cur.notify.intervalMinutes)),
    topN: Math.max(1, num(form, "topN", cur.notify.topN)),
    dailyLimit: Math.max(1, num(form, "dailyLimit", cur.notify.dailyLimit)),
    quietStartHour: clampHour(num(form, "quietStartHour", cur.notify.quietStartHour)),
    quietEndHour: clampHour(num(form, "quietEndHour", cur.notify.quietEndHour)),
    urgentEnabled: form.get("urgentEnabled") !== null,
  });

  await audit(user.email, "update_notify_settings");
  return NextResponse.redirect(new URL("/notify/settings?saved=1", req.url), 303);
}
