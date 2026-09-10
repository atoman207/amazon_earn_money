import { describe, expect, it } from "vitest";
import {
  filterByMinRate,
  nextSortState,
  partitionByMinRate,
  quantityValue,
  sortDiscountRows,
  summarizeDiscounts,
  toCsv,
  verdictForRate,
} from "./discounts";

const row = (over: Partial<Parameters<typeof sortDiscountRows>[0][number]> = {}) => ({
  no: 1,
  discount_rate: 20,
  discount_amount: 1000,
  unit_price: 4000,
  ...over,
});

describe("verdictForRate", () => {
  it("下限ちょうどは満たしたものとして扱う", () => {
    expect(verdictForRate({ discountRate: 30 }, 30)).toBe("keep");
    expect(verdictForRate({ discountRate: 30.1 }, 30)).toBe("keep");
  });

  it("下限未満は below", () => {
    expect(verdictForRate({ discountRate: 29.9 }, 30)).toBe("below");
    expect(verdictForRate({ discountRate: 0 }, 5)).toBe("below");
  });

  it("読み取れなかったものは unknown（高割引と断定しない）", () => {
    expect(verdictForRate({ discountRate: null }, 10)).toBe("unknown");
    expect(verdictForRate({ discountRate: Number.NaN }, 10)).toBe("unknown");
  });
});

describe("partitionByMinRate", () => {
  it("満たす・満たさない・読めないの3つに分ける", () => {
    const items = [
      { asin: "A", discountRate: 35 },
      { asin: "B", discountRate: 12 },
      { asin: "C", discountRate: null },
      { asin: "D", discountRate: 20 },
    ];
    const { kept, below, unknown } = partitionByMinRate(items, 20);
    expect(kept.map((i) => i.asin)).toEqual(["A", "D"]);
    expect(below.map((i) => i.asin)).toEqual(["B"]);
    expect(unknown.map((i) => i.asin)).toEqual(["C"]);
  });
});

describe("sortDiscountRows", () => {
  it("割引率の高い順に並べ、null は後ろへ回す", () => {
    const rows = [
      row({ no: 1, discount_rate: 10 }),
      row({ no: 2, discount_rate: null }),
      row({ no: 3, discount_rate: 40 }),
    ];
    expect(
      sortDiscountRows(rows, { column: "discount_rate", direction: "desc" }).map((r) => r.no),
    ).toEqual([3, 1, 2]);
  });

  it("向きを反転しても null は後ろのまま", () => {
    const rows = [
      row({ no: 1, discount_rate: 10 }),
      row({ no: 2, discount_rate: null }),
      row({ no: 3, discount_rate: 40 }),
    ];
    expect(
      sortDiscountRows(rows, { column: "discount_rate", direction: "asc" }).map((r) => r.no),
    ).toEqual([1, 3, 2]);
  });

  it("同率のときは取得順を保つ", () => {
    const rows = [row({ no: 5, discount_rate: 30 }), row({ no: 2, discount_rate: 30 })];
    expect(
      sortDiscountRows(rows, { column: "discount_rate", direction: "desc" }).map((r) => r.no),
    ).toEqual([2, 5]);
  });

  it("どの列でも昇降どちらにも並べ替えられる", () => {
    const rows = [
      row({ no: 1, discount_amount: 100, unit_price: 900, reference_price: 1000 }),
      row({ no: 2, discount_amount: 900, unit_price: 100, reference_price: 200 }),
    ];
    const order = (state: Parameters<typeof sortDiscountRows>[1]) =>
      sortDiscountRows(rows, state).map((r) => r.no);

    expect(order({ column: "discount_amount", direction: "desc" })).toEqual([2, 1]);
    expect(order({ column: "discount_amount", direction: "asc" })).toEqual([1, 2]);
    expect(order({ column: "unit_price", direction: "asc" })).toEqual([2, 1]);
    expect(order({ column: "unit_price", direction: "desc" })).toEqual([1, 2]);
    expect(order({ column: "reference_price", direction: "asc" })).toEqual([2, 1]);
    expect(order({ column: "no", direction: "desc" })).toEqual([2, 1]);
  });

  it("数量は「20+」のような表記でも数として比べる", () => {
    const rows = [
      row({ no: 1, quantity: "5+" }),
      row({ no: 2, quantity: "100+" }),
      row({ no: 3, quantity: "20" }),
      row({ no: 4, quantity: null }),
    ];
    expect(
      sortDiscountRows(rows, { column: "quantity", direction: "asc" }).map((r) => r.no),
    ).toEqual([1, 3, 2, 4]);
  });

  it("商品名は日本語の並びで比べ、空欄は後ろへ回す", () => {
    const rows = [
      row({ no: 1, name: "ぼーるぺん" }),
      row({ no: 2, name: "あいすぺーぱー" }),
      row({ no: 3, name: "" }),
    ];
    expect(sortDiscountRows(rows, { column: "name", direction: "asc" }).map((r) => r.no)).toEqual([
      2, 1, 3,
    ]);
  });

  it("元の配列は変えない", () => {
    const rows = [row({ no: 1, discount_rate: 10 }), row({ no: 2, discount_rate: 40 })];
    sortDiscountRows(rows, { column: "discount_rate", direction: "desc" });
    expect(rows.map((r) => r.no)).toEqual([1, 2]);
  });
});

describe("nextSortState", () => {
  it("同じ列をもう一度押すと向きが反転する", () => {
    expect(nextSortState({ column: "discount_rate", direction: "desc" }, "discount_rate")).toEqual({
      column: "discount_rate",
      direction: "asc",
    });
    expect(nextSortState({ column: "discount_rate", direction: "asc" }, "discount_rate")).toEqual({
      column: "discount_rate",
      direction: "desc",
    });
  });

  it("別の列を押すと、その列の見たい向きから始まる", () => {
    // 割引は「高い順」、価格は「安い順」から見たい
    expect(nextSortState({ column: "no", direction: "asc" }, "discount_rate")).toEqual({
      column: "discount_rate",
      direction: "desc",
    });
    expect(nextSortState({ column: "discount_rate", direction: "desc" }, "unit_price")).toEqual({
      column: "unit_price",
      direction: "asc",
    });
  });
});

describe("quantityValue", () => {
  it("表記から数だけ取り出す", () => {
    expect(quantityValue("20+")).toBe(20);
    expect(quantityValue("1")).toBe(1);
    expect(quantityValue(null)).toBeNull();
    expect(quantityValue("—")).toBeNull();
  });
});

describe("filterByMinRate", () => {
  it("0 のときは素通しする", () => {
    const rows = [row({ discount_rate: 5 }), row({ discount_rate: null })];
    expect(filterByMinRate(rows, 0)).toHaveLength(2);
  });

  it("下限を満たさない行と読めない行を落とす", () => {
    const rows = [
      row({ no: 1, discount_rate: 25 }),
      row({ no: 2, discount_rate: 15 }),
      row({ no: 3, discount_rate: null }),
    ];
    expect(filterByMinRate(rows, 20).map((r) => r.no)).toEqual([1]);
  });
});

describe("summarizeDiscounts", () => {
  it("件数・最高割引率・中央値・割引額の合計を出す", () => {
    const rows = [
      row({ discount_rate: 10, discount_amount: 100 }),
      row({ discount_rate: 20, discount_amount: 200 }),
      row({ discount_rate: 40, discount_amount: 300 }),
    ];
    const s = summarizeDiscounts(rows);
    expect(s).toEqual({ count: 3, maxRate: 40, medianRate: 20, totalSaving: 600 });
  });

  it("偶数件の中央値は真ん中2つの平均", () => {
    const rows = [row({ discount_rate: 10 }), row({ discount_rate: 20 })];
    expect(summarizeDiscounts(rows).medianRate).toBe(15);
  });

  it("空のときは率を null にする", () => {
    expect(summarizeDiscounts([])).toEqual({
      count: 0,
      maxRate: null,
      medianRate: null,
      totalSaving: 0,
    });
  });
});

describe("toCsv", () => {
  const csvRow = {
    no: 1,
    asin: "B0TEST0001",
    name: "テスト商品",
    quantity: "20+",
    reference_price: 5000,
    unit_price: 3500,
    discount_rate: 30,
    discount_amount: 1500,
    product_url: "https://www.amazon.co.jp/dp/B0TEST0001",
    image_url: null,
  };

  it("見出しと明細を CRLF でつなぐ", () => {
    const lines = toCsv([csvRow]).split("\r\n");
    expect(lines[0]).toBe("No,ASIN,商品名,数量,参考価格,ビジネス価格,割引率(%),割引額(円),商品URL,画像URL");
    expect(lines[1]).toBe(
      "1,B0TEST0001,テスト商品,20+,5000,3500,30,1500,https://www.amazon.co.jp/dp/B0TEST0001,",
    );
  });

  it("カンマ・引用符・改行を含む商品名を壊さない", () => {
    const csv = toCsv([{ ...csvRow, name: 'A4用紙, 500枚 "厚手"\n2箱' }]);
    expect(csv.split("\r\n")[1]).toContain('"A4用紙, 500枚 ""厚手""\n2箱"');
  });
});
