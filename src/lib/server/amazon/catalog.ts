/**
 * Amazonビジネス割引ページの選択肢。
 * backend/api.py の CATEGORY_OPTIONS / DISCOUNT_OPTIONS / SORT_OPTIONS を
 * そのまま移植したもの。ラベルは Amazon の画面表示と一致させること
 * （カテゴリはラベル一致で選択するため、表記ゆれがあると選べなくなる）。
 */

export interface CategoryOption {
  id: number;
  sortOrder: number;
  label: string;
  /** Amazon 側の input[name="category"] の value。ラベル一致に失敗したときの予備 */
  value: number;
}

export interface DiscountOption {
  id: number;
  sortOrder: number;
  label: string;
  /** %以上。Amazon 側は businessSavingFilter{value} */
  value: number;
}

export interface SortOption {
  id: number;
  sortOrder: number;
  label: string;
  value: string;
}

export const CATEGORY_OPTIONS: CategoryOption[] = [
  { id: 1, sortOrder: 0, label: "オフィス用品", value: 5 },
  { id: 2, sortOrder: 1, label: "製造業向け用品", value: 4 },
  { id: 3, sortOrder: 2, label: "IT関連機器", value: 2 },
  { id: 4, sortOrder: 3, label: "レストラン・飲食店向け用品", value: 13 },
  { id: 5, sortOrder: 4, label: "車・車両部品向け用品", value: 6 },
  { id: 6, sortOrder: 5, label: "医療用品・消耗品", value: 9 },
  { id: 7, sortOrder: 6, label: "日用品・食品・飲料", value: 1 },
  { id: 8, sortOrder: 7, label: "ホテル向け用品", value: 15 },
  { id: 9, sortOrder: 8, label: "清掃・衛生管理用品", value: 3 },
  { id: 10, sortOrder: 9, label: "教育機関向け用品", value: 11 },
  { id: 11, sortOrder: 10, label: "研究機関向け用品・消耗品", value: 7 },
  { id: 12, sortOrder: 11, label: "レストラン・飲食店向け機器", value: 14 },
  { id: 13, sortOrder: 12, label: "幼児教育向け用品", value: 12 },
  { id: 14, sortOrder: 13, label: "美容室・理容室向け用品", value: 16 },
  { id: 15, sortOrder: 14, label: "その他", value: 0 },
];

export const DISCOUNT_OPTIONS: DiscountOption[] = [
  { id: 1, sortOrder: 0, label: "5%", value: 5 },
  { id: 2, sortOrder: 1, label: "10%", value: 10 },
  { id: 3, sortOrder: 2, label: "15%", value: 15 },
  { id: 4, sortOrder: 3, label: "20%", value: 20 },
  { id: 5, sortOrder: 4, label: "25%", value: 25 },
  { id: 6, sortOrder: 5, label: "30%", value: 30 },
];

export const SORT_OPTIONS: SortOption[] = [
  { id: 1, sortOrder: 0, label: "おすすめ", value: "recommended" },
  { id: 2, sortOrder: 1, label: "ビジネス割引: 昇順", value: "business_discount_asc" },
  { id: 3, sortOrder: 2, label: "ビジネス割引: 降順", value: "business_discount_desc" },
  { id: 4, sortOrder: 3, label: "法人価格: 昇順", value: "corporate_price_asc" },
  { id: 5, sortOrder: 4, label: "法人価格: 降順", value: "corporate_price_desc" },
  { id: 6, sortOrder: 5, label: "平均 カスタマーレビュー", value: "avg_review" },
];

/** アプリ内の並べ替え値 → Amazon の data-value */
export const SORT_VALUE_TO_AMAZON: Record<string, string> = {
  recommended: "featured",
  business_discount_asc: "businessSavingsLowHigh",
  business_discount_desc: "businessSavingsHighLow",
  corporate_price_asc: "businessPriceLowHigh",
  corporate_price_desc: "businessPriceHighLow",
  avg_review: "avgCustomerReview",
};

export const SEND_METHODS = ["Chatwork", "Slack", "LINE"] as const;
export type SendMethod = (typeof SEND_METHODS)[number];

export const MAX_CATEGORIES = CATEGORY_OPTIONS.length;

export function categoryById(id: number): CategoryOption | undefined {
  return CATEGORY_OPTIONS.find((c) => c.id === id);
}

/** 受け取った id 配列を検証し、重複を除いて並べ替える */
export function normalizeCategoryIds(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  for (const item of list) {
    const n = Number(item);
    if (!Number.isInteger(n)) continue;
    if (!categoryById(n)) continue;
    if (out.includes(n)) continue;
    out.push(n);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

export function normalizeDiscount(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return DISCOUNT_OPTIONS.some((d) => d.value === n) ? n : null;
}

export function normalizeSortValue(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return SORT_OPTIONS.some((s) => s.value === v) ? v : null;
}

export function normalizeSendMethods(raw: unknown): SendMethod[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: SendMethod[] = [];
  for (const item of list) {
    const v = String(item);
    const hit = SEND_METHODS.find((m) => m === v);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}
