import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { listCartItems } from "@/lib/server/cart";
import { promoteCartItems } from "@/lib/server/promote";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * カートの中身をまとめて採算判定へ載せる。
 * 商品マスタ・監視リスト・価格観測を作り、手数料込みの利益まで計算する。
 */
export async function POST() {
  const me = await currentUser();
  if (!me) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  const items = await listCartItems(me.id);
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "カートが空です" }, { status: 400 });
  }

  const results = await promoteCartItems(items);
  return NextResponse.json({
    ok: true,
    total: results.length,
    evaluated: results.filter((r) => r.evaluated).length,
    passed: results.filter((r) => r.passed).length,
    results,
  });
}
