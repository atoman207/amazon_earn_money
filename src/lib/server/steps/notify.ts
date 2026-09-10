import "server-only";
import { forecastPrice, type ForecastResult } from "@/lib/domain/forecast";
import { buildFlexMessage, inQuietHours, sendLineNotification } from "@/lib/server/line";
import { chatworkConfigured, lineConfigured, slackConfigured } from "@/lib/server/notify";
import { loadSettings } from "@/lib/server/settings";
import { loadAsin } from "@/lib/server/steps/universe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { NotifySettings } from "@/lib/domain/types";
import type {
  NotificationRow,
  OpportunityRow,
  ProductRow,
} from "@/lib/supabase/database.types";

/**
 * ④ LINE通知。
 *
 * 通知は「送れたかどうか」ではなく「何を伝えたか」が大事なので、
 * 画面には実際に送る本文をそのまま出す。画面と通知で内容が違ってはいけない。
 *
 * 送信の判断（静穏時間・1日の上限・重複）はここに1つだけ置き、
 * cron からも画面のボタンからも同じ関数を通す。
 */

export interface NotifyCard {
  opportunity: OpportunityRow;
  product: ProductRow | null;
  /** 実際にLINEへ送る本文 */
  text: string;
  /** すでに送ったか */
  notified: boolean;
  /** 過去1年の価格（グラフ用） */
  history: Array<{ date: string; price: number }>;
  forecast: ForecastResult | null;
  /** 現在の価格（発注直前の再確認に使う値） */
  currentBuyPrice: number | null;
}

export interface NotifyQueueView {
  cards: NotifyCard[];
  pending: number;
  notifySettings: NotifySettings;
  quiet: boolean;
  sentToday: number;
  remaining: number;
  channels: Array<{ name: string; configured: boolean; note: string }>;
}

function channelStatus() {
  return [
    {
      name: "LINE",
      configured: lineConfigured(),
      note: "LINE_CHANNEL_ACCESS_TOKEN / LINE_TO_USER_ID",
    },
    { name: "ChatWork", configured: chatworkConfigured(), note: "CHATWORK_TOKEN / CHATWORK_ROOM_ID" },
    { name: "Slack", configured: slackConfigured(), note: "SLACK_WEBHOOK_URL" },
  ];
}

/** 今日すでに送った件数 */
async function sentTodayCount(): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count } = await supabaseAdmin()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", dayStart.toISOString());
  return count ?? 0;
}

/** 通知の下書き一覧（④-1）。送る前に中身を確認できるようにする。 */
export async function notifyQueue(limit = 6): Promise<NotifyQueueView> {
  const db = supabaseAdmin();
  const settings = await loadSettings();

  const [{ data: rows, count }, sentToday] = await Promise.all([
    db
      .from("opportunities")
      .select("*, products(*)", { count: "exact" })
      .eq("status", "pending")
      .eq("passed", true)
      .order("score", { ascending: false })
      .limit(limit),
    sentTodayCount(),
  ]);

  const list = (rows ?? []) as unknown as Array<OpportunityRow & { products: ProductRow | null }>;

  const cards: NotifyCard[] = [];
  for (const op of list) {
    const { data: already } = await db
      .from("notifications")
      .select("id")
      .eq("opportunity_id", op.id)
      .limit(1);

    const snapshot = await loadAsin(op.asin, 365);
    const history = snapshot?.daily ?? [];
    const forecast = history.length >= 3 ? forecastPrice({ history }) : null;

    cards.push({
      opportunity: op,
      product: op.products,
      text: op.products ? buildFlexMessage(op, op.products) : "商品マスタが見つかりません",
      notified: Boolean(already?.length),
      history,
      forecast,
      currentBuyPrice:
        typeof snapshot?.latest?.buy_price === "number" ? snapshot.latest.buy_price : null,
    });
  }

  return {
    cards,
    pending: count ?? cards.length,
    notifySettings: settings.notify,
    quiet: inQuietHours(new Date(), settings.notify.quietStartHour, settings.notify.quietEndHour),
    sentToday,
    remaining: Math.max(0, settings.notify.dailyLimit - sentToday),
    channels: channelStatus(),
  };
}

export interface DispatchResult {
  ok: boolean;
  sent: number;
  skipped: string | null;
  ids: string[];
  errors: string[];
}

/**
 * 候補をLINEへ送る。
 *
 * 守ること：
 *   - 静穏時間帯には送らない（force で押し切れるが、押した記録は残る）
 *   - 1日の上限を超えない
 *   - 同じ候補は二度送らない
 */
export async function dispatchNotifications(options: { force?: boolean } = {}): Promise<DispatchResult> {
  const db = supabaseAdmin();
  const settings = await loadSettings();

  if (
    !options.force &&
    inQuietHours(new Date(), settings.notify.quietStartHour, settings.notify.quietEndHour)
  ) {
    return { ok: true, sent: 0, skipped: "静穏時間帯", ids: [], errors: [] };
  }

  const remaining = Math.max(0, settings.notify.dailyLimit - (await sentTodayCount()));
  if (remaining === 0) {
    return { ok: true, sent: 0, skipped: "1日の上限に到達", ids: [], errors: [] };
  }

  const { data: candidates } = await db
    .from("opportunities")
    .select("*, products(*)")
    .eq("status", "pending")
    .eq("passed", true)
    .order("score", { ascending: false })
    .limit(Math.min(settings.notify.topN, remaining));

  const ids: string[] = [];
  const errors: string[] = [];

  for (const c of (candidates ?? []) as unknown as Array<OpportunityRow & { products: ProductRow | null }>) {
    const { data: already } = await db
      .from("notifications")
      .select("id")
      .eq("opportunity_id", c.id)
      .limit(1);
    if (already?.length) continue;
    if (!c.products) {
      errors.push(`${c.asin}: 商品マスタが見つかりません`);
      continue;
    }

    const result = await sendLineNotification(c.id, buildFlexMessage(c, c.products));
    ids.push(c.id);
    if (result.error) errors.push(`${c.asin}: ${result.error}`);
  }

  return { ok: true, sent: ids.length, skipped: null, ids, errors };
}

export type NotificationWithOpportunity = NotificationRow & {
  opportunities: (OpportunityRow & { products: ProductRow | null }) | null;
};

export interface NotifyHistoryView {
  rows: NotificationWithOpportunity[];
  delivered: number;
  failed: number;
  /** 今日の送信数 */
  today: number;
  byDay: Array<{ date: string; count: number }>;
}

/** 送信履歴（④-2） */
export async function notifyHistory(limit = 60): Promise<NotifyHistoryView> {
  const { data } = await supabaseAdmin()
    .from("notifications")
    .select("*, opportunities(*, products(*))")
    .order("sent_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as NotificationWithOpportunity[];
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = r.sent_at.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }

  const today = new Date().toISOString().slice(0, 10);

  return {
    rows,
    delivered: rows.filter((r) => r.delivered).length,
    failed: rows.filter((r) => !r.delivered).length,
    today: byDay.get(today) ?? 0,
    byDay: [...byDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export interface NotifySettingsView {
  notify: NotifySettings;
  channels: Array<{ name: string; configured: boolean; note: string }>;
  quiet: boolean;
  sentToday: number;
  pending: number;
}

/** 通知の設定（④-3） */
export async function notifySettingsView(): Promise<NotifySettingsView> {
  const settings = await loadSettings();
  const [sentToday, { count }] = await Promise.all([
    sentTodayCount(),
    supabaseAdmin()
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("passed", true),
  ]);

  return {
    notify: settings.notify,
    channels: channelStatus(),
    quiet: inQuietHours(new Date(), settings.notify.quietStartHour, settings.notify.quietEndHour),
    sentToday,
    pending: count ?? 0,
  };
}
