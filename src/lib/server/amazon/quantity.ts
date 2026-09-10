/** Playwright に依存しない数量・金額テキストの整形 */

export function formatQuantity(qty: string | null | undefined): string {
  if (!qty) return "";
  const s = String(qty).trim();
  if (s.endsWith("+")) {
    const n = s.slice(0, -1).trim();
    return n ? `${n}個以上` : s;
  }
  if (s === "1") return "1個";
  return /^\d+$/.test(s) ? `${s}個` : s;
}

/** 「¥1,599」「31.5%」などから数値を取り出す（extract_number 相当） */
export function extractNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[¥,円\s]|JPY/g, "");
  const m = cleaned.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
