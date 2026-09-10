import type { Locator, Page } from "playwright";
import { SORT_VALUE_TO_AMAZON, categoryById } from "./catalog";
import { extractNumber, formatQuantity } from "./quantity";
import { sleep } from "./sleep";
import type { ScrapedProduct } from "./types";

export { extractNumber, formatQuantity };
export type { ScrapedProduct };

/**
 * Amazonビジネス割引ページのスクレイピング。
 * backend/amazon_auto.py の apply_filters_and_sort() / scrape_all_products() /
 * scrape_product_from_listing() を TypeScript に移植したもの。
 *
 * セレクタは Amazon の DOM に依存するため、壊れたときはここだけ直せばよい。
 */

export const BUSINESS_DISCOUNTS_URL =
  "https://www.amazon.co.jp/ab/business-discounts?ref_=abn_cs_savings_guide";

const AMAZON_PRODUCT_URL_BASE = "https://www.amazon.co.jp/dp";

/** 画面の XPath（amazon_auto.py と同じ） */
const CATEGORY_DROPDOWN_BUTTON =
  "xpath=/html/body/div[1]/div[1]/div/div/div[3]/section/div/div/div/div/div[1]/div[2]/div[1]/div[1]/span/span/input";
const CATEGORY_SHOW_RESULTS_BUTTON =
  "xpath=/html/body/div[1]/div[1]/div/div/div[3]/section/div/div/div/div/div[1]/div[2]/div[1]/div[2]/div[3]/div[2]/span/span";
const DISCOUNT_DROPDOWN_BUTTON =
  "xpath=/html/body/div[1]/div[1]/div/div/div[3]/section/div/div/div/div/div[1]/div[2]/div[2]/div[1]/span/span/input";
const DISCOUNT_SHOW_RESULTS_BUTTON =
  "xpath=/html/body/div[1]/div[1]/div/div/div[3]/section/div/div/div/div/div[1]/div[2]/div[2]/div[2]/div[4]/div[2]/span/span/input";
const SORT_DROPDOWN_BUTTON =
  "xpath=/html/body/div[1]/div[1]/div/div/div[3]/section/div/div/div/div/div[1]/div[2]/span/span/span/span/span/span[1]";

const PRODUCT_CONTAINER = "div.a-cardui._dmFsd_cardItem_1LFgv[data-a-card-type='basic']";
const PRODUCT_CONTAINER_FALLBACK = "div.a-cardui._dmFsd_cardItem_1LFgv";

export interface ScrapeOptions {
  categoryIds: number[];
  minDiscountRate: number;
  sortValue: string;
  /** 進捗の通知先。UI のログにそのまま出す */
  onProgress?: (step: string, line: string) => void | Promise<void>;
  /** これ以上は取得しない上限。暴走防止 */
  maxProducts?: number;
  /** 新規商品が見つからないスクロールがこの回数続いたら終了 */
  maxIdleScrolls?: number;
}

async function clickIfPresent(locator: Locator, delayAfterMs = 1500): Promise<boolean> {
  if ((await locator.count()) === 0) return false;
  const target = locator.first();
  await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  await target.click({ force: true, timeout: 5000 }).catch(() => undefined);
  await sleep(delayAfterMs);
  return true;
}

/**
 * カテゴリをラベル文字で選ぶ。Amazon が内部の value 番号を変えても
 * 日本語名は安定しているため、ラベル一致を第一手段にする
 * （_click_category_by_label 相当）。
 */
async function clickCategoryByLabel(page: Page, label: string): Promise<boolean> {
  const clicked = await page
    .evaluate((wanted) => {
      const rows = document.querySelectorAll('div[data-a-input-name="category"]');
      for (const row of Array.from(rows)) {
        if ((row.textContent ?? "").includes(wanted)) {
          const input = row.querySelector<HTMLElement>('input[name="category"]');
          if (input) {
            input.scrollIntoView({ block: "center" });
            input.click();
            return true;
          }
          (row as HTMLElement).scrollIntoView({ block: "center" });
          (row as HTMLElement).click();
          return true;
        }
      }
      for (const el of Array.from(document.querySelectorAll("label, span, div"))) {
        if ((el.textContent ?? "").trim() === wanted) {
          const parent = el.closest('div[data-a-input-name="category"]');
          if (!parent) continue;
          const input = parent.querySelector<HTMLElement>('input[name="category"]');
          if (input) {
            input.scrollIntoView({ block: "center" });
            input.click();
            return true;
          }
          (parent as HTMLElement).scrollIntoView({ block: "center" });
          (parent as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, label)
    .catch(() => false);

  if (clicked) {
    await sleep(500);
    return true;
  }

  // 予備：Playwright のテキストセレクタ
  const row = page.locator(`div[data-a-input-name="category"]:has-text("${label}")`);
  if ((await row.count()) > 0) {
    const input = row.first().locator('input[name="category"]');
    const target = (await input.count()) > 0 ? input.first() : row.first();
    await target.click({ force: true, timeout: 3000 }).catch(() => undefined);
    await sleep(500);
    return true;
  }
  return false;
}

/** value 番号での予備選択 */
async function clickCategoryByValue(page: Page, value: number): Promise<boolean> {
  const ok = await page
    .evaluate((v) => {
      const el = document.querySelector<HTMLElement>(`input[name="category"][value="${v}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    }, value)
    .catch(() => false);
  if (ok) await sleep(500);
  return ok;
}

/**
 * カテゴリ・割引率・並べ替えを適用する（apply_filters_and_sort 相当）。
 * 個々の手順は失敗しても続行し、何が適用できたかをログへ残す。
 */
export async function applyFiltersAndSort(page: Page, opts: ScrapeOptions) {
  const report = async (step: string, line: string) => {
    await opts.onProgress?.(step, line);
  };

  const labels = opts.categoryIds
    .map((id) => categoryById(id))
    .filter((c): c is NonNullable<ReturnType<typeof categoryById>> => Boolean(c));

  // ---- 1. カテゴリ ----
  await report("filter_categories", "[FILTER] カテゴリの絞り込みを開いています…");
  const categoryOpened = await clickIfPresent(page.locator(CATEGORY_DROPDOWN_BUTTON), 1500);
  if (!categoryOpened) {
    await report("filter_categories", "[WARNING] カテゴリの絞り込みが見つかりませんでした");
  } else {
    // モーダル内を一度スクロールして全項目を描画させる
    await sleep(1000);
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, 200);
      await sleep(200);
    }
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel(0, -150);
      await sleep(200);
    }
    await sleep(500);

    let selected = 0;
    for (const cat of labels) {
      if (await clickCategoryByLabel(page, cat.label)) {
        selected += 1;
        await report("filter_categories", `[OK] カテゴリ「${cat.label}」を選択しました`);
        continue;
      }
      if (await clickCategoryByValue(page, cat.value)) {
        selected += 1;
        await report("filter_categories", `[OK] カテゴリ「${cat.label}」を選択しました（予備）`);
      } else {
        await report("filter_categories", `[WARNING] カテゴリ「${cat.label}」を選択できませんでした`);
      }
    }
    await report("filter_categories", `[INFO] ${selected}/${labels.length} 件のカテゴリを選択しました`);

    if (!(await clickIfPresent(page.locator(CATEGORY_SHOW_RESULTS_BUTTON), 2000))) {
      // 予備：パネル内の表示されている送信ボタンを押す
      await page
        .evaluate(() => {
          const btns = document.querySelectorAll<HTMLElement>(
            'input[type="submit"], button[type="submit"], span.a-button-text',
          );
          for (const b of Array.from(btns)) {
            if (b.offsetParent !== null) {
              b.click();
              return;
            }
          }
        })
        .catch(() => undefined);
      await sleep(2000);
    }
    await sleep(1500);
  }

  // ---- 2. 割引率 ----
  await report("filter_discount", `[FILTER] ${opts.minDiscountRate}% 以上の割引で絞り込みます…`);
  if (await clickIfPresent(page.locator(DISCOUNT_DROPDOWN_BUTTON), 1500)) {
    await sleep(800);
    const picked = await page
      .evaluate((rate) => {
        const byValue = document.querySelector<HTMLElement>(
          `input[name="filter"][value="businessSavingFilter${rate}"]`,
        );
        if (byValue) {
          byValue.scrollIntoView({ block: "center" });
          byValue.click();
          return true;
        }
        const rows = document.querySelectorAll('div[data-a-input-name="filter"]');
        for (const r of Array.from(rows)) {
          if ((r.textContent ?? "").includes(`${rate}%`)) {
            const i = r.querySelector<HTMLElement>('input[name="filter"]');
            if (i) {
              i.scrollIntoView({ block: "center" });
              i.click();
              return true;
            }
            (r as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, opts.minDiscountRate)
      .catch(() => false);

    if (picked) {
      await sleep(500);
      await report("filter_discount", `[OK] ${opts.minDiscountRate}% 以上を選択しました`);
    } else {
      await report("filter_discount", "[WARNING] 割引率を選択できませんでした");
    }
    if (!(await clickIfPresent(page.locator(DISCOUNT_SHOW_RESULTS_BUTTON), 2000))) {
      await report("filter_discount", "[WARNING] 割引率の「結果を表示」が見つかりませんでした");
    }
    await sleep(1500);
  } else {
    await report("filter_discount", "[WARNING] 割引率の絞り込みが見つかりませんでした");
  }

  // ---- 3. 並べ替え ----
  const amazonSort = SORT_VALUE_TO_AMAZON[opts.sortValue] ?? "businessSavingsHighLow";
  await report("filter_sort", `[FILTER] 並べ替えを適用します（${amazonSort}）…`);
  if (await clickIfPresent(page.locator(SORT_DROPDOWN_BUTTON), 1500)) {
    await sleep(500);
    let option = page.locator(`.a-popover-inner a.a-dropdown-link[data-value*="${amazonSort}"]`);
    if ((await option.count()) === 0) {
      option = page.locator(`a.a-dropdown-link[data-value*="${amazonSort}"]`);
    }
    if ((await option.count()) > 0) {
      await option.first().click({ force: true, timeout: 5000 }).catch(() => undefined);
      await sleep(2000);
      await report("filter_sort", "[OK] 並べ替えを適用しました");
    } else {
      await report("filter_sort", `[WARNING] 並べ替え「${amazonSort}」が見つかりませんでした`);
    }
  } else {
    await report("filter_sort", "[WARNING] 並べ替えの操作部が見つかりませんでした");
  }

  await sleep(2000);
}

/** 商品カード1枚から数量別価格を読み、最も割引率の高い段を返す（scrape_product_from_listing 相当） */
async function scrapeProductCard(container: Locator): Promise<ScrapedProduct | null> {
  const asin = await container
    .locator("[data-asin]")
    .first()
    .getAttribute("data-asin")
    .catch(() => null);
  if (!asin || asin.length !== 10) return null;

  const firstText = async (selectors: string[]): Promise<string | null> => {
    for (const sel of selectors) {
      const el = container.locator(sel).first();
      if ((await el.count().catch(() => 0)) === 0) continue;
      const text = await el.innerText().catch(() => "");
      if (text.trim()) return text.trim();
    }
    return null;
  };

  // 商品名
  let name = await firstText([
    "span.a-truncate-full.a-offscreen",
    ".a-truncate-full",
    "h2 a span",
  ]);
  if (!name) {
    name = await container.locator("a[title]").first().getAttribute("title").catch(() => null);
  }

  // 画像
  let imageUrl: string | null = null;
  for (const sel of [
    'figure img[src*="media-amazon.com"]',
    'img[alt="商品画像"]',
    "figure img",
    "._dmFsd_productImage_18Th9",
    'img[src*="media-amazon.com"]',
  ]) {
    const el = container.locator(sel).first();
    if ((await el.count().catch(() => 0)) === 0) continue;
    const src = await el.getAttribute("src").catch(() => null);
    if (src && src.includes("media-amazon.com")) {
      imageUrl = src;
      break;
    }
  }

  // 参考価格（個人向けの取り消し線価格）
  const referencePrice = extractNumber(
    await firstText([
      "._dmFsd_retailPriceMobileInt_22uHn .a-offscreen",
      "._dmFsd_retailPriceInt_HVi7A .a-offscreen",
      'span.a-price.a-text-price[data-a-strike="true"] .a-offscreen',
      ".a-text-price .a-offscreen",
      'span[data-a-strike="true"] .a-offscreen',
    ]),
  );

  // バッジに出ている割引率（数量別から計算できなかったときの予備）
  const badgeRate = extractNumber(
    await firstText([
      "span._dmFsd_savingsBadge_25xkz",
      "span._dmFsd_businessSavingsMobileInt_2V1aF",
      "div._dmFsd_businessSavingsInt_2W0Iq",
    ]),
  );

  // 「さらに読み込む」があれば押して、隠れている数量段を出す
  const loadMore = container
    .locator('div._dmFsd_qpLoadMoreBtn_1uSIC, button:has-text("さらに読み込む")')
    .first();
  if ((await loadMore.count().catch(() => 0)) > 0) {
    if (await loadMore.isVisible({ timeout: 500 }).catch(() => false)) {
      await loadMore.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
      await loadMore.click({ timeout: 2000 }).catch(() => undefined);
      await sleep(800);
    }
  }

  // 数量別価格の段
  const tiers: Array<{ quantity: string; unitPrice: number }> = [];
  const tierItems = await container
    .locator("ul._dmFsd_qpDropdown_2UuXs li._dmFsd_qpItem_3tHmj")
    .all()
    .catch(() => []);

  for (const item of tierItems) {
    // 数量は入れ子の div から読む（li 側は常に "1" のため）
    let quantity: string | null = null;
    const qtySpan = item.locator("div._dmFsd_qpItemQuantity_3S1pu span").first();
    if ((await qtySpan.count().catch(() => 0)) > 0) {
      const t = await qtySpan.innerText().catch(() => "");
      if (t.trim()) quantity = t.trim(); // 「20+」の "+" を保つ
    }
    if (!quantity) {
      quantity = await item
        .locator("div._dmFsd_qpItemQuantity_3S1pu")
        .first()
        .getAttribute("data-minimum-quantity")
        .catch(() => null);
    }
    if (!quantity) {
      quantity = await item.getAttribute("data-minimum-quantity").catch(() => null);
    }

    const unitPrice = extractNumber(await item.getAttribute("data-numeric-value").catch(() => null));
    if (quantity && unitPrice != null) tiers.push({ quantity, unitPrice });
  }

  // 数量別が無ければ通常のビジネス価格を1段として扱う
  if (tiers.length === 0) {
    const base = extractNumber(
      await firstText([
        "span.a-price._dmFsd_businessPriceMobileInt_3u3XJ .a-offscreen",
        "span.a-price._dmFsd_businessPriceInt_oPUj8 .a-offscreen",
        'span.a-price .a-offscreen:not([data-a-strike="true"])',
        "span.a-price-whole",
      ]),
    );
    if (base != null) tiers.push({ quantity: "1", unitPrice: base });
  }

  if (tiers.length === 0) return null;

  // 各段の割引率を計算し、最も割引率が高い段を採用する
  const scored = tiers.map((t) => {
    if (referencePrice != null && referencePrice > 0) {
      const amount = referencePrice - t.unitPrice;
      const rate = (amount / referencePrice) * 100;
      return { ...t, discountRate: Math.round(rate * 10) / 10, discountAmount: Math.round(amount) };
    }
    return { ...t, discountRate: badgeRate, discountAmount: null as number | null };
  });

  const best = scored.reduce((a, b) => ((b.discountRate ?? -1) > (a.discountRate ?? -1) ? b : a));

  return {
    asin,
    name: name ?? asin,
    quantity: best.quantity,
    referencePrice,
    unitPrice: best.unitPrice,
    discountRate: best.discountRate,
    discountAmount: best.discountAmount,
    imageUrl,
    productUrl: `${AMAZON_PRODUCT_URL_BASE}/${asin}`,
  };
}

/**
 * 絞り込み済みの一覧をスクロールしながら全商品を取得する
 * （scrape_all_products 相当。Google Sheets ではなく呼び出し側へ流す）。
 */
export async function scrapeAllProducts(
  page: Page,
  opts: ScrapeOptions & { onProduct?: (p: ScrapedProduct, index: number) => void | Promise<void> },
): Promise<ScrapedProduct[]> {
  const report = async (step: string, line: string) => {
    await opts.onProgress?.(step, line);
  };

  const maxProducts = opts.maxProducts ?? 1000;
  const maxIdle = opts.maxIdleScrolls ?? 5;
  /** 打ち切る前に「末尾まで送って待つ」を試す回数 */
  const maxBottomJumps = 3;

  const seen = new Set<string>();
  const products: ScrapedProduct[] = [];
  let scrolls = 0;
  let idle = 0;
  let emptyScrolls = 0;
  let bottomJumps = 0;

  await report("scrape", "[INFO] 商品の取得を開始します…");

  while (products.length < maxProducts) {
    let containers = await page.locator(PRODUCT_CONTAINER).all().catch(() => []);
    if (containers.length === 0) {
      containers = await page.locator(PRODUCT_CONTAINER_FALLBACK).all().catch(() => []);
    }

    if (containers.length === 0) {
      emptyScrolls += 1;
      if (emptyScrolls > 50) {
        await report(
          "scrape",
          "[WARNING] 商品カードが見つかりませんでした。画面構造が変わった可能性があります",
        );
        break;
      }
      await page.mouse.wheel(0, 500);
      await sleep(1500);
      scrolls += 1;
      continue;
    }
    emptyScrolls = 0;

    let found = 0;
    for (const container of containers) {
      if (products.length >= maxProducts) break;
      const asin = await container
        .locator("[data-asin]")
        .first()
        .getAttribute("data-asin")
        .catch(() => null);
      if (!asin || asin.length !== 10 || seen.has(asin)) continue;
      seen.add(asin);

      const product = await scrapeProductCard(container).catch(() => null);
      if (!product) continue;

      products.push(product);
      found += 1;
      await opts.onProduct?.(product, products.length);
    }

    if (found > 0) {
      // まだ出てくる＝末尾判定はやり直し
      idle = 0;
      bottomJumps = 0;
      await report("scrape", `[OK] ${found}件を取得（合計 ${products.length}件）`);
    } else {
      idle += 1;
      // 次のページがあれば進む
      const next = page
        .locator("a.s-pagination-next:not(.s-pagination-disabled), li.a-last:not(.a-disabled) a")
        .first();
      const hasNext =
        (await next.count().catch(() => 0)) > 0 &&
        (await next.isVisible({ timeout: 1000 }).catch(() => false));
      if (hasNext) {
        await report("scrape", "[INFO] 次のページへ移動します…");
        await next.click({ timeout: 5000 }).catch(() => undefined);
        await sleep(3000);
        idle = 0;
        continue;
      }
      if (idle >= maxIdle) {
        // ページ末尾まで送ると遅延読み込みが走ることがある。
        // 送っただけで打ち切らず、読み込みを待ってからもう一度数える。
        if (bottomJumps < maxBottomJumps) {
          bottomJumps += 1;
          await report(
            "scrape",
            `[INFO] ページ末尾まで送って追加の読み込みを待ちます（${bottomJumps}/${maxBottomJumps}）…`,
          );
          await page
            .evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            .catch(() => undefined);
          await sleep(3000);
          idle = 0;
          continue;
        }
        await report("scrape", "[INFO] これ以上の商品は見つかりませんでした");
        break;
      }
    }

    await page.mouse.wheel(0, 500);
    await sleep(1200);
    scrolls += 1;
    if (scrolls > 400) {
      await report("scrape", "[WARNING] スクロール上限に達したため終了します");
      break;
    }
  }

  await report("scrape", `[SUCCESS] 合計 ${products.length}件を取得しました`);
  return products;
}

/** 割引ページを開く */
export async function openDiscountPage(page: Page, onProgress?: ScrapeOptions["onProgress"]) {
  await onProgress?.("open", "[INFO] ビジネス割引ページを開いています…");
  await page.goto(BUSINESS_DISCOUNTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(2500);
}
