import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { addToCart, clearCart, listCartItems, removeFromCart } from "@/lib/server/cart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const unauthorized = () =>
  NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });

/** 自分のカートの中身 */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json({ ok: true, items: await listCartItems(me.id) });
}

/**
 * 一覧の1行を自分のカートへ入れる。
 * 値段は画面から受け取らず、productId から DB を読み直して写す。
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const productId = Number(body.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ ok: false, error: "商品を特定できませんでした" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  try {
    const item = await addToCart(me.id, productId, note);
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "カートに入れられませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** ?asin= を外す。?all=1 なら空にする。どちらも自分のカートだけが対象。 */
export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();

  const url = new URL(req.url);
  const asin = url.searchParams.get("asin");
  const all = url.searchParams.get("all") === "1";

  try {
    if (all) {
      const removed = await clearCart(me.id);
      return NextResponse.json({ ok: true, removed });
    }
    if (!asin) {
      return NextResponse.json({ ok: false, error: "商品を特定できませんでした" }, { status: 400 });
    }
    await removeFromCart(me.id, asin);
    return NextResponse.json({ ok: true, removed: 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "カートを更新できませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
