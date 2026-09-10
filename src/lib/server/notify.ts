import "server-only";
import { formatQuantity } from "@/lib/server/amazon/quantity";
import type { DiscountProductRow, DiscountScanRow } from "@/lib/supabase/database.types";

/**
 * ChatWork へ割引ランキングを送る。
 * backend/amazon_auto.py の _build_rankings_text() / send_rankings_to_chatwork() を移植。
 * 記法（[info][title]…）は ChatWork のメッセージ記法なのでそのまま残す。
 */

const CHATWORK_API = "https://api.chatwork.com/v2";

export interface RankingEntry {
  asin: string;
  name: string;
  quantity: string | null;
  discountRate: number | null;
  discountAmount: number | null;
  imageUrl: string | null;
  productUrl: string | null;
}

export interface Rankings {
  byDiscountRate: RankingEntry[];
  byDiscountAmount: RankingEntry[];
}

const fmtRate = (rate: number | null) => (rate == null ? "" : `${rate.toFixed(1)}%`);
const fmtAmount = (amount: number | null) =>
  amount == null ? "" : `¥${Math.round(amount).toLocaleString("ja-JP")}`;

/** 上位5件ずつのランキングを作る（analyze_spreadsheet_rankings 相当） */
export function buildRankings(products: DiscountProductRow[]): Rankings {
  const toEntry = (p: DiscountProductRow): RankingEntry => ({
    asin: p.asin,
    name: p.name,
    quantity: p.quantity,
    discountRate: p.discount_rate,
    discountAmount: p.discount_amount,
    imageUrl: p.image_url,
    productUrl: p.product_url,
  });

  const byRate = [...products]
    .filter((p) => p.discount_rate != null)
    .sort((a, b) => (b.discount_rate ?? 0) - (a.discount_rate ?? 0))
    .slice(0, 5)
    .map(toEntry);

  const byAmount = [...products]
    .filter((p) => p.discount_amount != null)
    .sort((a, b) => (b.discount_amount ?? 0) - (a.discount_amount ?? 0))
    .slice(0, 5)
    .map(toEntry);

  return { byDiscountRate: byRate, byDiscountAmount: byAmount };
}

/** ChatWork のメッセージ本文を組み立てる */
export function buildChatworkMessage(
  rankings: Rankings,
  scan: Pick<DiscountScanRow, "category_labels" | "min_discount_rate" | "product_count">,
): string {
  const lines: string[] = ["[info][title]割引率が高い商品 上位5件[/title]", ""];

  const addBlock = (entries: RankingEntry[], value: (e: RankingEntry) => string) => {
    if (entries.length === 0) {
      lines.push("データなし", "");
      return;
    }
    entries.forEach((entry, i) => {
      const qty = formatQuantity(entry.quantity);
      lines.push(`${i + 1}位: ${entry.asin} ${value(entry)}${qty ? ` 数量${qty}` : ""}`);
      lines.push(entry.name.length > 60 ? `${entry.name.slice(0, 60)}…` : entry.name);
      // 画像URLは ChatWork がプレビュー表示する
      if (entry.imageUrl?.startsWith("http")) lines.push(`[url]${entry.imageUrl}[/url]`);
      if (entry.productUrl) lines.push(`商品ページを開く: [url]${entry.productUrl}[/url]`);
      lines.push("");
    });
  };

  // 送るのは「割引率が高い順の5件」。割引額は各行に添える。
  addBlock(
    rankings.byDiscountRate,
    (e) => `${fmtRate(e.discountRate)}（${fmtAmount(e.discountAmount)}お得）`,
  );
  lines.push("[hr]");

  const cats = scan.category_labels.length ? scan.category_labels.join("、") : "指定なし";
  lines.push(`カテゴリ: ${cats}`);
  lines.push(`割引率: ${scan.min_discount_rate}% 以上 / 取得件数: ${scan.product_count}件`);
  lines.push("[/info]");

  return lines.join("\n");
}

export function chatworkConfigured(): boolean {
  return Boolean(process.env.CHATWORK_TOKEN?.trim() && process.env.CHATWORK_ROOM_ID?.trim());
}

/** ChatWork のルームへ送信。未設定でも例外にはせず false を返す。 */
export async function sendToChatwork(body: string): Promise<{ ok: boolean; message: string }> {
  const token = process.env.CHATWORK_TOKEN?.trim();
  const roomId = process.env.CHATWORK_ROOM_ID?.trim();
  if (!token || !roomId) {
    return { ok: false, message: "CHATWORK_TOKEN / CHATWORK_ROOM_ID が未設定のため送信しません" };
  }

  try {
    const res = await fetch(`${CHATWORK_API}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: {
        "X-ChatWorkToken": token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, message: `ChatWork API エラー: ${res.status} ${text.slice(0, 200)}` };
    }
    return { ok: true, message: "ChatWork へ送信しました" };
  } catch (err) {
    return {
      ok: false,
      message: `ChatWork への送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL?.trim());
}

/** Slack の Incoming Webhook へ同じ内容を送る（send_rankings_to_slack 相当の簡易版） */
export async function sendToSlack(text: string): Promise<{ ok: boolean; message: string }> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return { ok: false, message: "SLACK_WEBHOOK_URL が未設定のため送信しません" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { ok: false, message: `Slack Webhook エラー: ${res.status}` };
    }
    return { ok: true, message: "Slack へ送信しました" };
  } catch (err) {
    return {
      ok: false,
      message: `Slack への送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** ChatWork 記法を落として、Slack / LINE 用の素のテキストにする */
export function toPlainText(chatworkBody: string): string {
  return chatworkBody
    .replace(/\[info\]|\[\/info\]|\[hr\]/g, "")
    .replace(/\[title\]|\[\/title\]/g, "")
    .replace(/\[url\]|\[\/url\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function lineConfigured(): boolean {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() && process.env.LINE_TO_USER_ID?.trim());
}

/**
 * LINE へ素のテキストを送る。
 * 候補通知（sendLineNotification）は opportunities に紐づくが、
 * 割引スキャンは紐づかないのでここでは push だけ行う。
 */
export async function sendToLine(text: string): Promise<{ ok: boolean; message: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const to = process.env.LINE_TO_USER_ID?.trim();
  if (!token || !to) {
    return { ok: false, message: "LINE_CHANNEL_ACCESS_TOKEN / LINE_TO_USER_ID が未設定のため送信しません" };
  }
  try {
    // LINE のテキストは5000文字まで
    const body = text.length > 4900 ? `${text.slice(0, 4900)}…` : text;
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text: body }] }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, message: `LINE APIエラー ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true, message: "LINE へ送信しました" };
  } catch (err) {
    return {
      ok: false,
      message: `LINE への送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
