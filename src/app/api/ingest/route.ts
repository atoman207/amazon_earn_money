import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestAndEvaluate } from "@/lib/server/pipeline";
import { loadSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 価格収集ワーカー（Collector）からの取り込み口。
 * 観測を追記し、値引きなら利益を計算して候補にする。
 */
const schema = z.object({
  observations: z
    .array(
      z.object({
        asin: z.string().min(1),
        buyPrice: z.number().positive().nullable().optional(),
        sellPrice: z.number().positive().nullable().optional(),
        offerCount: z.number().int().nonnegative().nullable().optional(),
        salesRank: z.number().int().positive().nullable().optional(),
        inStock: z.boolean().optional(),
        source: z.string().optional(),
        observedAt: z.string().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です", detail: parsed.error.issues }, { status: 400 });
  }

  const settings = await loadSettings();
  const results = [];
  for (const o of parsed.data.observations) {
    results.push(await ingestAndEvaluate(o, settings));
  }

  return NextResponse.json({
    ok: true,
    received: results.length,
    created: results.filter((r) => r.created).length,
    passed: results.filter((r) => r.passed).length,
    results,
  });
}
