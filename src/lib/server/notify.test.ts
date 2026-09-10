import { describe, expect, it } from "vitest";
import { buildChatworkMessage, buildRankings, toPlainText } from "./notify";
import type { DiscountProductRow } from "@/lib/supabase/database.types";

const product = (over: Partial<DiscountProductRow>): DiscountProductRow => ({
  id: 1,
  scan_id: "s1",
  no: 1,
  asin: "B000000001",
  name: "テスト商品",
  quantity: "1",
  reference_price: 1000,
  unit_price: 800,
  discount_rate: 20,
  discount_amount: 200,
  image_url: null,
  product_url: "https://www.amazon.co.jp/dp/B000000001",
  scraped_at: "2026-09-09T00:00:00Z",
  ...over,
});

describe("buildRankings", () => {
  it("割引率順・割引額順にそれぞれ上位5件を出す", () => {
    const products = [
      product({ id: 1, asin: "B00000000A", discount_rate: 10, discount_amount: 5000 }),
      product({ id: 2, asin: "B00000000B", discount_rate: 40, discount_amount: 100 }),
      product({ id: 3, asin: "B00000000C", discount_rate: 25, discount_amount: 900 }),
    ];
    const r = buildRankings(products);
    expect(r.byDiscountRate.map((e) => e.asin)).toEqual([
      "B00000000B",
      "B00000000C",
      "B00000000A",
    ]);
    expect(r.byDiscountAmount.map((e) => e.asin)).toEqual([
      "B00000000A",
      "B00000000C",
      "B00000000B",
    ]);
  });

  it("割引率が無い行は率ランキングから外す", () => {
    const r = buildRankings([product({ discount_rate: null, discount_amount: null })]);
    expect(r.byDiscountRate).toHaveLength(0);
    expect(r.byDiscountAmount).toHaveLength(0);
  });

  it("6件以上でも5件までにする", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      product({ id: i, asin: `B0000000${i}X`, discount_rate: i + 1 }),
    );
    expect(buildRankings(many).byDiscountRate).toHaveLength(5);
  });
});

describe("buildChatworkMessage", () => {
  const scan = { category_labels: ["IT関連機器"], min_discount_rate: 20, product_count: 3 };

  it("割引率が高い順の5件を、割引額を添えて出す", () => {
    const body = buildChatworkMessage(
      buildRankings([product({ image_url: "https://img.example/1.jpg" })]),
      scan,
    );
    expect(body).toContain("[info][title]割引率が高い商品 上位5件[/title]");
    expect(body).toContain("1位: B000000001 20.0%（¥200お得） 数量1個");
    expect(body).toContain("[url]https://img.example/1.jpg[/url]");
    expect(body).toContain("IT関連機器");
    expect(body.endsWith("[/info]")).toBe(true);
  });

  it("割引額のランキングは載せない（送るのは率の上位5件だけ）", () => {
    const body = buildChatworkMessage(buildRankings([product({})]), scan);
    expect(body).not.toContain("割引額が大きい商品ランキング");
  });

  it("該当が無ければ「データなし」を出す", () => {
    const body = buildChatworkMessage(buildRankings([]), scan);
    expect(body).toContain("データなし");
  });
});

describe("toPlainText", () => {
  it("ChatWork記法を取り除く", () => {
    const plain = toPlainText("[info][title]見出し[/title]\n[hr]\n[url]https://a.example[/url][/info]");
    expect(plain).not.toContain("[info]");
    expect(plain).not.toContain("[title]");
    expect(plain).not.toContain("[url]");
    expect(plain).toContain("見出し");
    expect(plain).toContain("https://a.example");
  });
});
