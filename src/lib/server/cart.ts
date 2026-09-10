import "server-only";
import { promoteCartItem } from "@/lib/server/promote";
import { audit } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CartItemRow, DiscountProductRow } from "@/lib/supabase/database.types";

/**
 * カート＝割引検索で見つけた中から、利用者が選んだ商品だけを残す場所。
 *
 * discount_products はスキャンごとの作業用リストで、実行のたびに増えていく。
 * こちらは「カートに入れる」を押したものだけが入る、正式な保存先。
 *
 * 保存する内容は一覧で取得済みの情報をそのまま写す。
 * 値段を画面から受け取ると改ざんできてしまうので、必ずサーバーで
 * discount_products の行を読み直してから写す。
 */

/** 同じ商品を二度押しても増えないよう ASIN で一意にする */
const CONFLICT_KEY = "user_id,asin";

/** cart_items がまだ無いDBで、原因の分からないエラーにしないための言い換え */
function describeError(message: string): string {
  if (/cart_items|schema cache|does not exist/i.test(message)) {
    return "カートの保存先がまだありません。supabase/migrations/0001_init.sql の全文を SQL Editor で実行してください（npm run db:verify で確認できます）。";
  }
  return message;
}

export async function listCartItems(userId: string): Promise<CartItemRow[]> {
  const { data } = await supabaseAdmin()
    .from("cart_items")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  return (data as CartItemRow[] | null) ?? [];
}

/** 画面のボタン表示用。カートに入っている ASIN だけを返す。 */
export async function listCartAsins(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin().from("cart_items").select("asin").eq("user_id", userId);
  return ((data as Array<{ asin: string }> | null) ?? []).map((r) => r.asin);
}

/**
 * 一覧の1行をカートへ入れる。
 * すでに入っていれば、そのときの価格・割引率で上書きする（押し直し＝最新に更新）。
 */
export async function addToCart(
  userId: string,
  productId: number,
  note?: string | null,
): Promise<CartItemRow> {
  const { data: product, error: readError } = await supabaseAdmin()
    .from("discount_products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();

  if (readError) throw new Error(describeError(`商品を読み込めませんでした: ${readError.message}`));
  if (!product) throw new Error("その商品は見つかりませんでした。検索し直してください。");

  const row = product as DiscountProductRow;
  const { data, error } = await supabaseAdmin()
    .from("cart_items")
    .upsert(
      {
        user_id: userId,
        asin: row.asin,
        name: row.name,
        quantity: row.quantity,
        reference_price: row.reference_price,
        unit_price: row.unit_price,
        discount_rate: row.discount_rate,
        discount_amount: row.discount_amount,
        image_url: row.image_url,
        product_url: row.product_url,
        scan_id: row.scan_id,
        note: note ?? null,
        added_at: new Date().toISOString(),
      } as never,
      { onConflict: CONFLICT_KEY },
    )
    .select()
    .single();

  if (error) throw new Error(describeError(`カートに入れられませんでした: ${error.message}`));
  await audit("user", "cart_add", row.asin, {
    name: row.name,
    discountRate: row.discount_rate,
    unitPrice: row.unit_price,
  });

  const item = data as CartItemRow;

  // カートに入れた＝検討対象。そのまま採算判定のパイプラインへ載せる。
  // ここが「安く買えるものを探す」と「利益が出るか判定する」をつなぐ唯一の経路なので、
  // 失敗してもカート追加そのものは成功させ、理由だけ記録に残す。
  await promoteCartItem(item).catch(async (err: unknown) => {
    await audit("system", "promote_failed", item.asin, {
      message: err instanceof Error ? err.message : String(err),
    });
  });

  return item;
}

/** カートから外す */
export async function removeFromCart(userId: string, asin: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("cart_items")
    .delete()
    .eq("user_id", userId)
    .eq("asin", asin);
  if (error) throw new Error(describeError(`カートから外せませんでした: ${error.message}`));
  await audit("user", "cart_remove", asin, {});
}

/** カートを空にする */
export async function clearCart(userId: string): Promise<number> {
  const items = await listCartItems(userId);
  if (items.length === 0) return 0;
  const { error } = await supabaseAdmin().from("cart_items").delete().eq("user_id", userId);
  if (error) throw new Error(describeError(`カートを空にできませんでした: ${error.message}`));
  await audit("user", "cart_clear", null, { count: items.length });
  return items.length;
}
