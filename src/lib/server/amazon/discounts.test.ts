import { describe, expect, it } from "vitest";
import {
  normalizeCategoryIds,
  normalizeDiscount,
  normalizeSendMethods,
  normalizeSortValue,
} from "./catalog";
import { extractNumber, formatQuantity } from "./quantity";

describe("extractNumber", () => {
  it("円記号とカンマを外して数値にする", () => {
    expect(extractNumber("¥1,599")).toBe(1599);
    expect(extractNumber("84980円")).toBe(84980);
    expect(extractNumber("31.5%")).toBe(31.5);
  });

  it("数字が無ければ null", () => {
    expect(extractNumber("")).toBeNull();
    expect(extractNumber(null)).toBeNull();
    expect(extractNumber("価格未定")).toBeNull();
  });
});

describe("formatQuantity", () => {
  it("「20+」は「20個以上」にする", () => {
    expect(formatQuantity("20+")).toBe("20個以上");
    expect(formatQuantity("1")).toBe("1個");
    expect(formatQuantity("5")).toBe("5個");
    expect(formatQuantity("")).toBe("");
  });
});

describe("入力の正規化", () => {
  it("カテゴリは実在するidだけを重複なく残す", () => {
    expect(normalizeCategoryIds([3, 3, 6, 99, "7", null])).toEqual([3, 6, 7]);
    expect(normalizeCategoryIds("なにか")).toEqual([]);
  });

  it("割引率は選択肢にある値だけ通す", () => {
    expect(normalizeDiscount(30)).toBe(30);
    expect(normalizeDiscount("15")).toBe(15);
    expect(normalizeDiscount(17)).toBeNull();
  });

  it("並べ替えは既知の値だけ通す", () => {
    expect(normalizeSortValue("business_discount_desc")).toBe("business_discount_desc");
    expect(normalizeSortValue("drop table")).toBeNull();
  });

  it("送信方式は既知のものだけ重複なく残す", () => {
    expect(normalizeSendMethods(["Chatwork", "Chatwork", "LINE", "Fax"])).toEqual([
      "Chatwork",
      "LINE",
    ]);
  });
});
