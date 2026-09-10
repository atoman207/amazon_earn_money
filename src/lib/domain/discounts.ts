/**
 * 割引商品の選別・並べ替え・書き出し。
 *
 * Amazon の画面や Supabase に触らない純粋な計算だけを置く。
 * サーバー（保存前の選別）とブラウザ（一覧の並べ替え・CSV）の両方から使う。
 */

/** 割引率を持つもの。取得直後の商品にも、保存済みの行にも当てはまる形 */
export interface RateBearing {
  discountRate: number | null;
}

/** 選別の結果。除外した理由を分けて数えられるようにする */
export type RateVerdict = "keep" | "below" | "unknown";

/** 保存済み行のうち、並べ替えと集計に使う列だけ */
export interface DiscountRowLike {
  no: number;
  name?: string;
  quantity?: string | null;
  reference_price?: number | null;
  discount_rate: number | null;
  discount_amount: number | null;
  unit_price: number | null;
}

/** 並べ替えに使える列。表の見出しと1対1で対応する。 */
export type SortColumn =
  | "no"
  | "name"
  | "quantity"
  | "reference_price"
  | "unit_price"
  | "discount_rate"
  | "discount_amount";

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

/**
 * 見出しを最初に押したときの向き。
 * 「割引率」は高い順、「価格」は安い順から見たいことが多い、という前提。
 */
const FIRST_DIRECTION: Record<SortColumn, SortDirection> = {
  no: "asc",
  name: "asc",
  quantity: "asc",
  reference_price: "asc",
  unit_price: "asc",
  discount_rate: "desc",
  discount_amount: "desc",
};

export const DEFAULT_SORT: SortState = { column: "discount_rate", direction: "desc" };

/** 見出しを押したときの次の状態。同じ列なら向きを反転、違う列ならその列の既定の向き。 */
export function nextSortState(current: SortState, column: SortColumn): SortState {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: FIRST_DIRECTION[column] };
}

/** 「20+」「5」→ 数値。数量は文字列で持っているので、並べ替え用に数だけ取り出す。 */
export function quantityValue(quantity: string | null | undefined): number | null {
  if (!quantity) return null;
  const m = String(quantity).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 指定した割引率を満たすか判定する。
 *
 * Amazon 側の絞り込みが効いていれば全件 keep になる。効かなかったとき
 * （画面構造が変わってクリックできなかったときなど）にここで食い止める。
 * 割引率を読み取れなかったものは「高い割引」と断定できないので unknown にする。
 */
export function verdictForRate(item: RateBearing, minRate: number): RateVerdict {
  if (item.discountRate == null || !Number.isFinite(item.discountRate)) return "unknown";
  return item.discountRate >= minRate ? "keep" : "below";
}

/** verdictForRate をまとめて適用する */
export function partitionByMinRate<T extends RateBearing>(items: T[], minRate: number) {
  const kept: T[] = [];
  const below: T[] = [];
  const unknown: T[] = [];
  for (const item of items) {
    const verdict = verdictForRate(item, minRate);
    if (verdict === "keep") kept.push(item);
    else if (verdict === "below") below.push(item);
    else unknown.push(item);
  }
  return { kept, below, unknown };
}

/** null は向きにかかわらず常に後ろへ回す（空欄が先頭を占めないように） */
function compareNullable(a: number | null, b: number | null, direction: SortDirection) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? a - b : b - a;
}

/** 商品名は日本語の並びで比べる。空欄は後ろへ。 */
function compareText(a: string | null | undefined, b: string | null | undefined, direction: SortDirection) {
  const left = a?.trim() ?? "";
  const right = b?.trim() ?? "";
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const cmp = left.localeCompare(right, "ja");
  return direction === "asc" ? cmp : -cmp;
}

/** 指定した列の値を比べる */
function compareByColumn<T extends DiscountRowLike>(a: T, b: T, state: SortState) {
  const { column, direction } = state;
  switch (column) {
    case "name":
      return compareText(a.name, b.name, direction);
    case "quantity":
      return compareNullable(quantityValue(a.quantity), quantityValue(b.quantity), direction);
    case "reference_price":
      return compareNullable(a.reference_price ?? null, b.reference_price ?? null, direction);
    case "unit_price":
      return compareNullable(a.unit_price, b.unit_price, direction);
    case "discount_rate":
      return compareNullable(a.discount_rate, b.discount_rate, direction);
    case "discount_amount":
      return compareNullable(a.discount_amount, b.discount_amount, direction);
    case "no":
    default:
      return direction === "asc" ? a.no - b.no : b.no - a.no;
  }
}

/**
 * 一覧の並べ替え。元の配列は変えない。
 * 値が同じときは取得順（no）で決めるので、押すたびに行が入れ替わることはない。
 */
export function sortDiscountRows<T extends DiscountRowLike>(rows: T[], state: SortState): T[] {
  return [...rows].sort((a, b) => compareByColumn(a, b, state) || a.no - b.no);
}

/** 画面の絞り込み。保存済みの結果をさらに狭めて見るためのもの */
export function filterByMinRate<T extends DiscountRowLike>(rows: T[], minRate: number): T[] {
  if (!Number.isFinite(minRate) || minRate <= 0) return rows;
  return rows.filter((r) => r.discount_rate != null && r.discount_rate >= minRate);
}

export interface DiscountSummary {
  count: number;
  maxRate: number | null;
  medianRate: number | null;
  totalSaving: number;
}

/** 一覧の要約。件数・最高割引率・割引率の中央値・割引額の合計 */
export function summarizeDiscounts(rows: DiscountRowLike[]): DiscountSummary {
  const rates = rows
    .map((r) => r.discount_rate)
    .filter((r): r is number => r != null && Number.isFinite(r))
    .sort((a, b) => a - b);

  const median =
    rates.length === 0
      ? null
      : rates.length % 2 === 1
        ? rates[(rates.length - 1) / 2]
        : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;

  return {
    count: rows.length,
    maxRate: rates.length ? rates[rates.length - 1] : null,
    medianRate: median,
    totalSaving: rows.reduce((sum, r) => sum + (r.discount_amount ?? 0), 0),
  };
}

/** CSV の1セル。引用符・カンマ・改行を含むときだけ囲む */
function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvRow {
  no: number;
  asin: string;
  name: string;
  quantity: string | null;
  reference_price: number | null;
  unit_price: number | null;
  discount_rate: number | null;
  discount_amount: number | null;
  product_url: string | null;
  image_url: string | null;
}

const CSV_HEADER = [
  "No",
  "ASIN",
  "商品名",
  "数量",
  "参考価格",
  "ビジネス価格",
  "割引率(%)",
  "割引額(円)",
  "商品URL",
  "画像URL",
];

/** Excel で開ける CSV を作る。BOM は書き出し側で足す。 */
export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.no,
        r.asin,
        r.name,
        r.quantity,
        r.reference_price,
        r.unit_price,
        r.discount_rate,
        r.discount_amount,
        r.product_url,
        r.image_url,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
