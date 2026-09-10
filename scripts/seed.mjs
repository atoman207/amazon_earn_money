/**
 * デモ用のデータを投入する。
 *  - 商品14点（カテゴリ・手数料率・サイズ区分つき）
 *  - 直近90日の価格観測（1日3回）。うち数点は「いま値引き中」にする
 *  - 過去の売却実績と保有中ポジション（損益画面を意味あるものにするため）
 *
 * 何度実行しても同じ状態になる（先に消してから入れ直す）。
 */
import { admin } from "./lib.mjs";

const db = admin();
const DAY = 86_400_000;
const now = Date.now();

// 乱数は固定シードにして、実行するたび結果が変わらないようにする
let seed = 20260907;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const jitter = (base, pct) => base * (1 + (rand() - 0.5) * 2 * pct);

const products = [
  { asin: "B0DEMO0001", title: "ワイヤレスイヤホン ノイズキャンセリング 型番XY-100", brand: "Aurex", category: "家電・カメラ", size_tier: "small", referral_fee_rate: 0.08, base: 9900, rank: 1200, offers: 6, discount: 0.30 },
  { asin: "B0DEMO0002", title: "モバイルバッテリー 20000mAh USB-C 急速充電", brand: "Voltas", category: "家電・カメラ", size_tier: "small", referral_fee_rate: 0.08, base: 4980, rank: 800, offers: 9, discount: 0.24 },
  { asin: "B0DEMO0003", title: "電動歯ブラシ 替えブラシ8本セット", brand: "Cleara", category: "ビューティー", size_tier: "small", referral_fee_rate: 0.10, base: 6800, rank: 2400, offers: 4, discount: 0.27 },
  { asin: "B0DEMO0004", title: "ロボット掃除機 静音 水拭き対応", brand: "Homeo", category: "ホーム", size_tier: "large", referral_fee_rate: 0.10, base: 38800, rank: 5200, offers: 3, discount: 0.22 },
  { asin: "B0DEMO0005", title: "ゲーミングマウス 軽量 有線 8000DPI", brand: "Raptek", category: "PC・周辺機器", size_tier: "small", referral_fee_rate: 0.08, base: 5480, rank: 1500, offers: 11, discount: 0.18 },
  { asin: "B0DEMO0006", title: "プロテイン ホエイ 1kg チョコレート風味", brand: "FitCore", category: "食品・飲料", size_tier: "standard", referral_fee_rate: 0.10, base: 5200, rank: 900, offers: 14, discount: 0.12 },
  { asin: "B0DEMO0007", title: "折りたたみ傘 自動開閉 耐風", brand: "Rainy", category: "ファッション", size_tier: "small", referral_fee_rate: 0.12, base: 3280, rank: 3800, offers: 7, discount: 0.20 },
  { asin: "B0DEMO0008", title: "デスクライト LED 目に優しい 調光", brand: "Lumino", category: "ホーム", size_tier: "standard", referral_fee_rate: 0.10, base: 7480, rank: 2900, offers: 5, discount: 0.26 },
  { asin: "B0DEMO0009", title: "カメラ用SDカード 128GB V30", brand: "Datacell", category: "家電・カメラ", size_tier: "small", referral_fee_rate: 0.08, base: 3480, rank: 600, offers: 18, discount: 0.10 },
  { asin: "B0DEMO0010", title: "ヨガマット 10mm 滑り止め 収納袋付き", brand: "Zenith", category: "スポーツ", size_tier: "large", referral_fee_rate: 0.10, base: 4180, rank: 4200, offers: 8, discount: 0.15 },
  { asin: "B0DEMO0011", title: "コーヒーメーカー 全自動 ミル付き", brand: "Brewmax", category: "ホーム", size_tier: "large", referral_fee_rate: 0.10, base: 24800, rank: 3100, offers: 4, discount: 0.28 },
  { asin: "B0DEMO0012", title: "ワイヤレスキーボード 静音 テンキー付き", brand: "Raptek", category: "PC・周辺機器", size_tier: "standard", referral_fee_rate: 0.08, base: 6980, rank: 2200, offers: 6, discount: 0.21 },
  // 出品制限あり: 候補から必ず除外されることを確認するためのデータ
  { asin: "B0DEMO0013", title: "サプリメント ビタミンD 360粒", brand: "VitaOne", category: "ドラッグストア", size_tier: "small", referral_fee_rate: 0.10, base: 3980, rank: 1100, offers: 5, discount: 0.35, restricted: true, restricted_reason: "医薬品医療機器等法の確認が必要" },
  // 利益が出ない例: 門番が正しく落とすことを確認するためのデータ
  { asin: "B0DEMO0014", title: "文庫本カバー 合皮 しおり付き", brand: "Bookly", category: "文房具", size_tier: "small", referral_fee_rate: 0.15, base: 1280, rank: 8800, offers: 12, discount: 0.15 },
];

console.log("既存のデモデータを削除しています…");
const asins = products.map((p) => p.asin);
await db.from("sales").delete().in("asin", asins);
await db.from("exit_signals").delete().neq("id", "00000000-0000-0000-0000-000000000000");
await db.from("positions").delete().in("asin", asins);
await db.from("orders").delete().in("asin", asins);
await db.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
await db.from("opportunities").delete().in("asin", asins);
await db.from("price_observations").delete().in("asin", asins);
await db.from("price_stats").delete().in("asin", asins);
await db.from("watch_universe").delete().in("asin", asins);
await db.from("products").delete().in("asin", asins);

console.log("商品マスタを投入しています…");
{
  const { error } = await db.from("products").insert(
    products.map((p) => ({
      asin: p.asin,
      title: p.title,
      brand: p.brand,
      category: p.category,
      size_tier: p.size_tier,
      referral_fee_rate: p.referral_fee_rate,
      restricted: p.restricted ?? false,
      restricted_reason: p.restricted_reason ?? null,
    })),
  );
  if (error) throw new Error(`products: ${error.message}`);
}

{
  const { error } = await db.from("watch_universe").insert(
    products.map((p, i) => ({
      asin: p.asin,
      tier: i < 6 ? "A" : i < 10 ? "B" : "C",
      priority: 100 - i,
      active: true,
    })),
  );
  if (error) throw new Error(`watch_universe: ${error.message}`);
}

console.log("価格履歴（90日 × 1日3回）を生成しています…");
const rows = [];
for (const p of products) {
  let rank = p.rank;
  for (let d = 90; d >= 0; d--) {
    for (const hour of [8, 14, 20]) {
      const t = now - d * DAY + hour * 3_600_000 - 12 * 3_600_000;
      if (t > now) continue;

      // ふだんの相場は base の周りで小さく揺れる
      const sell = Math.round(jitter(p.base, 0.035));

      // 仕入価格。直近1日だけ、対象商品を値引き状態にする
      const isDiscountWindow = d <= 1;
      const buy = isDiscountWindow
        ? Math.round(p.base * (1 - p.discount))
        : Math.round(jitter(p.base * 0.97, 0.02));

      // ランキングは売れると改善し、時間で戻る
      const sold = rand() < 0.28;
      rank = sold ? Math.max(50, Math.round(rank * 0.82)) : Math.min(p.rank * 1.4, Math.round(rank * 1.04));

      rows.push({
        asin: p.asin,
        observed_at: new Date(t).toISOString(),
        buy_price: buy,
        sell_price: sell,
        offer_count: Math.max(1, Math.round(jitter(p.offers, 0.25))),
        sales_rank: Math.round(rank),
        in_stock: true,
        source: "seed",
      });
    }
  }
}

for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from("price_observations").insert(rows.slice(i, i + 500));
  if (error) throw new Error(`price_observations: ${error.message}`);
}
console.log(`   ${rows.length} 件の観測を投入しました`);

console.log("過去の取引実績を投入しています…");
// 売却済み3件 + 保有中3件。損益画面と在庫画面に中身を持たせる
const closed = [
  { p: products[0], qty: 3, openedDaysAgo: 42, heldDays: 11, sellPrice: 9900, rule: "E-1" },
  { p: products[2], qty: 2, openedDaysAgo: 35, heldDays: 18, sellPrice: 6800, rule: "E-2" },
  { p: products[6], qty: 4, openedDaysAgo: 28, heldDays: 9, sellPrice: 3180, rule: "E-3" },
];
const open = [
  { p: products[1], qty: 4, openedDaysAgo: 12 },
  { p: products[7], qty: 2, openedDaysAgo: 63 }, // 時間損切りに掛かる
  { p: products[10], qty: 1, openedDaysAgo: 5 },
];

const costs = { inbound: 150, pointsRate: 0.005, returnsRate: 0.02, storagePerDay: 8 };
const fbaByTier = { small: 290, standard: 434, large: 603, oversize: 1000 };

for (const c of [...closed, ...open]) {
  const buy = Math.round(c.p.base * (1 - c.p.discount));
  const acq = Math.round(buy - buy * costs.pointsRate + costs.inbound);
  const openedAt = new Date(now - c.openedDaysAgo * DAY).toISOString();

  const { data: order, error: oErr } = await db
    .from("orders")
    .insert({
      asin: c.p.asin,
      ordered_at: openedAt,
      qty: c.qty,
      unit_price: buy,
      acquisition_cost: acq,
      mode: "B",
      status: "placed",
    })
    .select("id")
    .single();
  if (oErr) throw new Error(`orders: ${oErr.message}`);

  const isClosed = "heldDays" in c;
  const { data: pos, error: posErr } = await db
    .from("positions")
    .insert({
      order_id: order.id,
      asin: c.p.asin,
      opened_at: openedAt,
      qty: c.qty,
      acquisition_cost: acq,
      target_price: c.p.base,
      stop_price: Math.round(acq * 0.9),
      peak_price: Math.round(c.p.base * 1.03),
      status: isClosed ? "sold" : "listed",
      closed_at: isClosed ? new Date(now - (c.openedDaysAgo - c.heldDays) * DAY).toISOString() : null,
    })
    .select("id")
    .single();
  if (posErr) throw new Error(`positions: ${posErr.message}`);

  if (isClosed) {
    const fees =
      Math.round(c.sellPrice * c.p.referral_fee_rate) +
      fbaByTier[c.p.size_tier] +
      Math.round(c.heldDays * costs.storagePerDay) +
      Math.round(c.sellPrice * costs.returnsRate);
    const profitPerUnit = c.sellPrice - fees - acq;
    const { error } = await db.from("sales").insert({
      position_id: pos.id,
      asin: c.p.asin,
      sold_at: new Date(now - (c.openedDaysAgo - c.heldDays) * DAY).toISOString(),
      qty: c.qty,
      sell_price: c.sellPrice,
      fees: fees * c.qty,
      realized_profit: profitPerUnit * c.qty,
      holding_days: c.heldDays,
      exit_rule: c.rule,
    });
    if (error) throw new Error(`sales: ${error.message}`);
  }
}

const { count: obsCount } = await db.from("price_observations").select("*", { count: "exact", head: true });
console.log(`\n✅ シード完了 — 商品 ${products.length} 点 / 観測 ${obsCount} 件 / 取引 ${closed.length + open.length} 件`);
console.log("   次に  npm run scan  を実行すると、値引きを検知して候補を作ります。");
