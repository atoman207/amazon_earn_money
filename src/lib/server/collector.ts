import "server-only";
import { ingestAndEvaluate, type ObservationInput } from "@/lib/server/pipeline";
import { audit, loadSettings } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * 価格の収集（①）。
 *
 * ここは「どこから価格を取るか」を差し替えられるようにした入り口。
 * 取れた観測は必ず ingestAndEvaluate を通し、②以降と同じ道を歩かせる。
 *
 * 大事な前提：**キーが無いのに動いているふりをしない**。
 * Keepa も SP-API も鍵が要る。未設定なら「未設定なので取れません」と言って止まる。
 * ここで適当な値を作ると、下流の利益計算がすべて嘘になる。
 */

export type CollectorName = "keepa" | "manual";

export interface CollectorStatus {
  name: CollectorName;
  label: string;
  /** 使える状態か（鍵が入っているか） */
  configured: boolean;
  /** なぜ使えないか */
  reason?: string;
  /** 何が取れるか */
  provides: string[];
}

export interface CollectResult {
  asin: string;
  ok: boolean;
  reason?: string;
  observation?: ObservationInput;
}

/* ------------------------------------------------------------------ */
/* Keepa                                                               */
/* ------------------------------------------------------------------ */

const KEEPA_ENDPOINT = "https://api.keepa.com/product";
/** Amazon.co.jp のドメイン番号（Keepa の仕様） */
const KEEPA_DOMAIN_JP = 5;

function keepaKey(): string | null {
  return process.env.KEEPA_API_KEY?.trim() || null;
}

export function keepaStatus(): CollectorStatus {
  const key = keepaKey();
  return {
    name: "keepa",
    label: "Keepa",
    configured: Boolean(key),
    reason: key ? undefined : "KEEPA_API_KEY が未設定です",
    provides: ["現在価格", "過去の価格", "販売ランキング", "競合出品者数"],
  };
}

/** Keepa の価格は「セント単位・−1 は欠測」で来る */
function keepaPrice(value: number | null | undefined): number | null {
  if (value == null || value < 0) return null;
  return value;
}

interface KeepaProduct {
  asin: string;
  stats?: {
    current?: number[];
    salesRankReference?: number;
  };
  offers?: unknown[];
  salesRanks?: Record<string, number[]>;
}

/**
 * Keepa から1商品の現在値を取る。
 * stats.current の並びは Keepa の仕様：
 *   0=Amazon本体, 1=新品最安, 2=中古最安, 3=販売ランキング, 18=カート価格
 */
export async function collectFromKeepa(asins: string[]): Promise<CollectResult[]> {
  const key = keepaKey();
  if (!key) {
    return asins.map((asin) => ({
      asin,
      ok: false,
      reason: "KEEPA_API_KEY が未設定のため取得できません",
    }));
  }
  if (asins.length === 0) return [];

  const url = new URL(KEEPA_ENDPOINT);
  url.searchParams.set("key", key);
  url.searchParams.set("domain", String(KEEPA_DOMAIN_JP));
  url.searchParams.set("asin", asins.slice(0, 100).join(","));
  url.searchParams.set("stats", "1");
  url.searchParams.set("offers", "20");

  let payload: { products?: KeepaProduct[]; error?: { message?: string } };
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return asins.map((asin) => ({
        asin,
        ok: false,
        reason: `Keepa API エラー ${res.status}: ${text.slice(0, 120)}`,
      }));
    }
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return asins.map((asin) => ({ asin, ok: false, reason: `Keepa への接続に失敗: ${message}` }));
  }

  if (payload.error) {
    return asins.map((asin) => ({
      asin,
      ok: false,
      reason: `Keepa API エラー: ${payload.error?.message ?? "詳細不明"}`,
    }));
  }

  const byAsin = new Map((payload.products ?? []).map((p) => [p.asin, p]));
  return asins.map((asin) => {
    const product = byAsin.get(asin);
    if (!product?.stats?.current) {
      return { asin, ok: false, reason: "Keepa に価格の記録がありません" };
    }

    const current = product.stats.current;
    const cart = keepaPrice(current[18]);
    const newLowest = keepaPrice(current[1]);
    const amazon = keepaPrice(current[0]);
    const salesRank = keepaPrice(current[3]);

    // 売値は「カート価格 → 新品最安」の順に採る
    const sellPrice = cart ?? newLowest;
    // 仕入値は Amazon 本体価格を当たりにする（無ければ新品最安）
    const buyPrice = amazon ?? newLowest;

    if (sellPrice == null || buyPrice == null) {
      return { asin, ok: false, reason: "価格が欠測しています" };
    }

    return {
      asin,
      ok: true,
      observation: {
        asin,
        buyPrice,
        sellPrice,
        offerCount: Array.isArray(product.offers) ? product.offers.length : null,
        salesRank: salesRank ?? null,
        inStock: true,
        source: "keepa",
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* 収集の実行                                                          */
/* ------------------------------------------------------------------ */

export function collectorStatuses(): CollectorStatus[] {
  return [
    keepaStatus(),
    {
      name: "manual",
      label: "手動取り込み（POST /api/ingest）",
      configured: Boolean(process.env.CRON_SECRET?.trim()),
      reason: process.env.CRON_SECRET?.trim() ? undefined : "CRON_SECRET が未設定です",
      provides: ["外部の収集ワーカーから送られた観測"],
    },
  ];
}

export interface CollectRunResult {
  collector: CollectorName;
  configured: boolean;
  attempted: number;
  collected: number;
  evaluated: number;
  failures: Array<{ asin: string; reason: string }>;
}

/**
 * 監視している銘柄の価格を取りに行き、取れたものを②以降へ流す。
 * 鍵が無ければ何もせず、その理由を返す。
 */
export async function collectWatched(limit = 100): Promise<CollectRunResult> {
  const status = keepaStatus();
  if (!status.configured) {
    return {
      collector: "keepa",
      configured: false,
      attempted: 0,
      collected: 0,
      evaluated: 0,
      failures: [{ asin: "-", reason: status.reason ?? "未設定です" }],
    };
  }

  const { data } = await supabaseAdmin()
    .from("watch_universe")
    .select("asin")
    .eq("active", true)
    .order("priority", { ascending: false })
    .limit(limit);

  const asins = ((data as Array<{ asin: string }> | null) ?? []).map((w) => w.asin);
  const results = await collectFromKeepa(asins);
  const settings = await loadSettings();

  let evaluated = 0;
  const failures: Array<{ asin: string; reason: string }> = [];

  for (const r of results) {
    if (!r.ok || !r.observation) {
      failures.push({ asin: r.asin, reason: r.reason ?? "取得できませんでした" });
      continue;
    }
    const outcome = await ingestAndEvaluate(r.observation, settings);
    if (outcome.created) evaluated += 1;
    else if (outcome.reason) failures.push({ asin: r.asin, reason: outcome.reason });
  }

  await audit("system", "collect_watched", null, {
    attempted: asins.length,
    collected: results.filter((r) => r.ok).length,
    evaluated,
  });

  return {
    collector: "keepa",
    configured: true,
    attempted: asins.length,
    collected: results.filter((r) => r.ok).length,
    evaluated,
    failures,
  };
}
