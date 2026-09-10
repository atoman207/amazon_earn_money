import "server-only";
import { verdictForRate } from "@/lib/domain/discounts";
import { withAmazonSession } from "@/lib/server/amazon/auth";
import { categoryById } from "@/lib/server/amazon/catalog";
import {
  applyFiltersAndSort,
  openDiscountPage,
  scrapeAllProducts,
  type ScrapedProduct,
} from "@/lib/server/amazon/discounts";
import {
  buildChatworkMessage,
  buildRankings,
  sendToChatwork,
  sendToLine,
  sendToSlack,
  toPlainText,
} from "@/lib/server/notify";
import { audit } from "@/lib/server/settings";
import { MISSING_COLUMN_RE, withCompatiblePayload } from "@/lib/server/schemaCompat";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  DiscountProductRow,
  DiscountScanRow,
  DiscountScanSummary,
} from "@/lib/supabase/database.types";

/**
 * ビジネス割引スキャンの司令塔。
 *   1. 保存済みセッションでAmazonビジネスにログイン
 *   2. カテゴリ・割引率・並べ替えを適用して検索
 *   3. 取得したそばから discount_products へ保存（割引率の下限を満たすものだけ）
 *   4. 選ばれた送信先（ChatWork / Slack / LINE）へランキングを送信
 * 進捗は discount_scans の step / log / heartbeat_at に書き、画面から見えるようにする。
 */

const MAX_LOG_LINES = 200;

/**
 * 見つけたそばから画面に出すための保存間隔。
 * この件数たまるか、この時間が過ぎたら書き出す。画面は 2.5 秒ごとに取りに来るので、
 * 利用者から見れば「見つかった順に増えていく」。
 */
const SAVE_BATCH = 3;
const SAVE_INTERVAL_MS = 1500;

/** 生存確認がこの時間途切れた実行は、落ちたものとみなす */
const STALE_MS = 10 * 60_000;

/**
 * heartbeat_at 列がまだ無いDBでは作成時刻しか手がかりが無い。
 * 動いている実行を巻き添えにしないよう、こちらは長めに待つ。
 */
const STALE_WITHOUT_HEARTBEAT_MS = 3 * 60 * 60_000;

/** 利用者が中止したときに投げる。失敗と区別して canceled で終えるため。 */
class ScanCanceled extends Error {
  constructor() {
    super("利用者の操作で中止しました");
    this.name = "ScanCanceled";
  }
}

export interface CreateScanInput {
  categoryIds: number[];
  minDiscountRate: number;
  sortValue: string;
  sendMethods: string[];
}

const SUMMARY_COLUMNS =
  "id,status,category_labels,min_discount_rate,sort_value,product_count,message,started_at,finished_at,created_at";

function isCancelFlagged(scan: Pick<DiscountScanRow, "log"> & { cancel_requested?: boolean } | null) {
  if (!scan) return false;
  if (scan.cancel_requested) return true;
  return (scan.log ?? []).some((line) => line.includes("[CANCEL_REQUESTED]"));
}

async function insertScan(row: Record<string, unknown>) {
  return withCompatiblePayload<DiscountScanRow>(row, async (payload) => {
    const { data, error } = await supabaseAdmin()
      .from("discount_scans")
      .insert(payload as never)
      .select()
      .single();
    return { data: (data as DiscountScanRow | null) ?? null, error };
  });
}

async function patchScan(id: string, row: Record<string, unknown>, onlyIfStatus?: DiscountScanRow["status"][]) {
  return withCompatiblePayload<null>(row, async (payload) => {
    let q = supabaseAdmin().from("discount_scans").update(payload as never).eq("id", id);
    if (onlyIfStatus?.length) q = q.in("status", onlyIfStatus);
    const { error } = await q;
    return { data: null, error };
  });
}

/** 実行待ちのスキャン行を作る。実際の処理は runDiscountScan() が行う。 */
export async function createScan(input: CreateScanInput): Promise<DiscountScanRow> {
  const labels = input.categoryIds
    .map((id) => categoryById(id)?.label)
    .filter((l): l is string => Boolean(l));

  const { data, error } = await insertScan({
    status: "queued",
    category_ids: input.categoryIds,
    category_labels: labels,
    min_discount_rate: input.minDiscountRate,
    sort_value: input.sortValue,
    send_methods: input.sendMethods,
    step: "queued",
    log: ["[INFO] 実行待ちに追加しました"],
    product_count: 0,
    cancel_requested: false,
    heartbeat_at: new Date().toISOString(),
  });

  if (error || !data) throw new Error(`スキャンを作成できませんでした: ${error?.message ?? "不明なエラー"}`);
  await audit("user", "discount_scan_create", (data as DiscountScanRow).id, {
    categories: labels,
    discount: input.minDiscountRate,
    sort: input.sortValue,
  });
  return data as DiscountScanRow;
}

export async function getScan(id: string): Promise<DiscountScanRow | null> {
  const { data } = await supabaseAdmin().from("discount_scans").select("*").eq("id", id).maybeSingle();
  return (data as DiscountScanRow | null) ?? null;
}

/** 直近のスキャン（実行中があればそれを優先） */
export async function latestScan(): Promise<DiscountScanRow | null> {
  const running = await supabaseAdmin()
    .from("discount_scans")
    .select("*")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (running.data) return running.data as DiscountScanRow;

  const { data } = await supabaseAdmin()
    .from("discount_scans")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DiscountScanRow | null) ?? null;
}

/** 履歴セレクタ用。過去の結果を選び直せるようにする。 */
export async function listScanSummaries(limit = 15): Promise<DiscountScanSummary[]> {
  const { data } = await supabaseAdmin()
    .from("discount_scans")
    .select(SUMMARY_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as DiscountScanSummary[] | null) ?? [];
}

export async function listScanProducts(scanId: string): Promise<DiscountProductRow[]> {
  const { data } = await supabaseAdmin()
    .from("discount_products")
    .select("*")
    .eq("scan_id", scanId)
    .order("no", { ascending: true });
  return (data as DiscountProductRow[] | null) ?? [];
}

/**
 * 実行が死んでいるとみなすか。
 * 生存確認があるならそれで、無いDB（列が未適用）では作成時刻で長めに待って判断する。
 * 動いている実行を巻き添えにすると、開いたままのブラウザが放置されるので慎重に。
 */
export function isStaleScan(
  row: { heartbeat_at?: string | null; created_at: string },
  now: number = Date.now(),
): boolean {
  const beatCutoff = new Date(now - STALE_MS).toISOString();
  const createdCutoff = new Date(now - STALE_WITHOUT_HEARTBEAT_MS).toISOString();
  return row.heartbeat_at ? row.heartbeat_at < beatCutoff : row.created_at < createdCutoff;
}

/**
 * 応答が途切れた実行を失効させる。
 * ブラウザごとプロセスが落ちると status が running のまま残り、
 * hasActiveScan() が真を返し続けて二度とスキャンを始められなくなるため。
 */
export async function reapStaleScans(): Promise<number> {
  type StaleRow = Pick<DiscountScanRow, "id" | "log" | "created_at"> & { heartbeat_at?: string | null };
  const withHeartbeat = await supabaseAdmin()
    .from("discount_scans")
    .select("id,log,heartbeat_at,created_at")
    .in("status", ["queued", "running"]);
  const staleQuery = withHeartbeat.error && MISSING_COLUMN_RE.test(withHeartbeat.error.message)
    ? await supabaseAdmin()
        .from("discount_scans")
        .select("id,log,created_at")
        .in("status", ["queued", "running"])
    : withHeartbeat;

  const stale = ((staleQuery.data as StaleRow[] | null) ?? []).filter((row) => isStaleScan(row));

  for (const row of stale) {
    const message = "応答が途切れたため中止しました（実行プロセスが落ちた可能性があります）";
    await patchScan(row.id, {
      status: "error",
      step: "error",
      message,
      finished_at: new Date().toISOString(),
      log: [...(row.log ?? []), `[ERROR] ${message}`].slice(-MAX_LOG_LINES),
    }, ["queued", "running"]);
    await audit("system", "discount_scan_stale", row.id, { message });
  }
  return stale.length;
}

/** 実行中スキャンがあるか（二重起動の防止）。先に失効したものを片付ける。 */
export async function hasActiveScan(): Promise<boolean> {
  await reapStaleScans();
  const { count } = await supabaseAdmin()
    .from("discount_scans")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "running"]);
  return (count ?? 0) > 0;
}

/**
 * 起動そのものに失敗した実行を、理由を残して終わらせる。
 * 子プロセスが import で落ちると自分では何も書けないので、親（Next）から書く。
 * すでに終わっている行には触れない。
 */
export async function failScan(scanId: string, message: string): Promise<void> {
  const current = await getScan(scanId);
  if (!current) return;
  if (current.status !== "queued" && current.status !== "running") return;

  await patchScan(
    scanId,
    {
      status: "error",
      step: "error",
      message,
      finished_at: new Date().toISOString(),
      log: [...(current.log ?? []), `[ERROR] ${message}`].slice(-MAX_LOG_LINES),
    },
    ["queued", "running"],
  );
  await audit("system", "discount_scan_spawn_failed", scanId, { message });
}

/**
 * 中止を要求する。実行は別プロセスなので、旗を立てて気付かせる。
 * まだ queued（プロセス未開始）ならその場で canceled にする。
 */
export async function requestCancel(scanId: string): Promise<DiscountScanRow | null> {
  const scan = await getScan(scanId);
  if (!scan) return null;
  if (scan.status !== "queued" && scan.status !== "running") return scan;

  await patchScan(scanId, {
    cancel_requested: true,
    log: [...(scan.log ?? []), "[CANCEL_REQUESTED] 中止を受け付けました"].slice(-MAX_LOG_LINES),
  });

  // queued のままなら誰も見ていないので、ここで終わらせる
  await patchScan(
    scanId,
    {
      status: "canceled",
      step: "canceled",
      message: "開始前に中止しました",
      finished_at: new Date().toISOString(),
      log: [...(scan.log ?? []), "[CANCEL_REQUESTED] 中止を受け付けました", "[WARNING] 開始前に中止しました"].slice(
        -MAX_LOG_LINES,
      ),
    },
    ["queued"],
  );

  await audit("user", "discount_scan_cancel", scanId, {});
  return await getScan(scanId);
}

/**
 * step / log / 生存時刻を更新する。ログは末尾 MAX_LOG_LINES 行だけ保つ。
 * 同じ読み取りで中止要求も見るので、進捗を出すたびに中止へ気付ける。
 */
async function pushProgress(scanId: string, step: string, line: string) {
  const current = await getScan(scanId);
  const log = [...(current?.log ?? []), line].slice(-MAX_LOG_LINES);
  await patchScan(scanId, { step, log, heartbeat_at: new Date().toISOString() });
  if (isCancelFlagged(current)) throw new ScanCanceled();
}

/** 取得した商品を保存する。no は startNo から連番で振る。 */
async function saveProducts(scanId: string, products: ScrapedProduct[], startNo: number) {
  if (products.length === 0) return;
  const rows = products.map((p, i) => ({
    scan_id: scanId,
    no: startNo + i,
    asin: p.asin,
    name: p.name,
    quantity: p.quantity,
    reference_price: p.referencePrice,
    unit_price: p.unitPrice,
    discount_rate: p.discountRate,
    discount_amount: p.discountAmount,
    image_url: p.imageUrl,
    product_url: p.productUrl,
  }));

  // Supabase の1回の挿入が大きくなりすぎないよう分割する
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin()
      .from("discount_products")
      .upsert(chunk as never, { onConflict: "scan_id,asin", ignoreDuplicates: true });
    if (error) throw new Error(`商品の保存に失敗しました: ${error.message}`);
  }
}

/**
 * 検索が終わったら、割引率が高い上位5件を ChatWork / Slack / LINE すべてへ送る。
 * 送信先を選ばせず常に3つへ出す（設定が無い先は「未設定のため送信しません」を残す）。
 * 送信の失敗で実行そのものを失敗扱いにはしない。
 */
async function notify(scan: DiscountScanRow, products: DiscountProductRow[]): Promise<string[]> {
  if (products.length === 0) return [];

  const rankings = buildRankings(products);
  const chatworkBody = buildChatworkMessage(rankings, scan);
  const plain = toPlainText(chatworkBody);

  const sends = [
    { label: "ChatWork", run: () => sendToChatwork(chatworkBody) },
    { label: "Slack", run: () => sendToSlack(plain) },
    { label: "LINE", run: () => sendToLine(plain) },
  ];

  const results: string[] = [];
  for (const send of sends) {
    const r = await send.run().catch((err: unknown) => ({
      ok: false,
      message: `${send.label} への送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    }));
    results.push(`[${r.ok ? "SUCCESS" : "WARNING"}] ${r.message}`);
  }
  return results;
}

/**
 * スキャンを実行する。長時間かかるため、API から直接 await せず
 * scripts/amazon-discount-scan.ts 経由の別プロセスで動かす。
 */
export async function runDiscountScan(scanId: string): Promise<DiscountScanRow> {
  const scan = await getScan(scanId);
  if (!scan) throw new Error(`スキャン ${scanId} が見つかりません`);

  await patchScan(scanId, {
    status: "running",
    step: "login",
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    message: null,
    log: [...scan.log, "[INFO] Amazonビジネスにログインしています…"],
  });

  // 取得しながら貯めて、SAVE_BATCH ごとに書き出す
  const buffer: ScrapedProduct[] = [];
  let savedCount = 0;
  let belowMin = 0;
  let unreadable = 0;

  let lastFlushAt = 0;

  const flush = async () => {
    lastFlushAt = Date.now();
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    await saveProducts(scanId, batch, savedCount + 1);
    savedCount += batch.length;
    await patchScan(scanId, { product_count: savedCount, heartbeat_at: new Date().toISOString() });
  };

  try {
    // 既定は実ブラウザ表示（元ツールと同じ）。サーバー常駐なら AMAZON_SCAN_HEADLESS=1 で伏せる。
    const mode = process.env.AMAZON_SCAN_HEADLESS === "1" ? "headless" : "headed";

    await withAmazonSession(
      async (page) => {
        await pushProgress(scanId, "login", "[OK] 保存済みセッションでログインしました");

        await openDiscountPage(page, async (step, line) => {
          await pushProgress(scanId, step, line);
        });

        const opts = {
          categoryIds: scan.category_ids,
          minDiscountRate: scan.min_discount_rate,
          sortValue: scan.sort_value,
          onProgress: async (step: string, line: string) => {
            await pushProgress(scanId, step, line);
          },
        };

        await applyFiltersAndSort(page, opts);

        return scrapeAllProducts(page, {
          ...opts,
          // 取得のたびに選別して貯める。画面の絞り込みが効かなかったときの最後の砦。
          onProduct: async (product) => {
            const verdict = verdictForRate(product, scan.min_discount_rate);
            if (verdict === "below") {
              belowMin += 1;
              return;
            }
            if (verdict === "unknown") {
              unreadable += 1;
              return;
            }
            buffer.push(product);
            // 少し貯まるか、少し時間が経ったら書き出す（画面へ順に出すため）
            if (buffer.length >= SAVE_BATCH || Date.now() - lastFlushAt >= SAVE_INTERVAL_MS) {
              await flush();
            }
          },
        });
      },
      { mode },
    );

    await flush();

    if (belowMin > 0) {
      await pushProgress(
        scanId,
        "scrape",
        `[INFO] 割引率が ${scan.min_discount_rate}% 未満の ${belowMin}件を除外しました`,
      );
    }
    if (unreadable > 0) {
      await pushProgress(
        scanId,
        "scrape",
        `[WARNING] 割引率を読み取れなかった ${unreadable}件を除外しました`,
      );
    }

    const saved = await listScanProducts(scanId);
    const refreshed = (await getScan(scanId)) ?? scan;

    let notifyLines: string[] = [];
    if (saved.length > 0) {
      await pushProgress(scanId, "notify", "[INFO] 上位5件を ChatWork / Slack / LINE へ送信しています…");
      notifyLines = await notify(refreshed, saved);
      for (const line of notifyLines) {
        await pushProgress(scanId, "notify", line);
      }
    }

    const finished = await getScan(scanId);
    const message =
      savedCount > 0
        ? `${scan.min_discount_rate}%以上の割引商品を ${savedCount}件見つけました`
        : "条件に合う商品は見つかりませんでした";

    await patchScan(scanId, {
      status: "success",
      step: "done",
      message,
      notified: notifyLines.some((l) => l.startsWith("[SUCCESS]")),
      finished_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      log: [...(finished?.log ?? []), `[SUCCESS] ${message}`].slice(-MAX_LOG_LINES),
    });

    await audit("system", "discount_scan_done", scanId, {
      productCount: savedCount,
      belowMin,
      unreadable,
    });
    return (await getScan(scanId)) as DiscountScanRow;
  } catch (err) {
    // 中止でも失敗でも、取れている分は残す
    await flush().catch(() => undefined);

    const canceled = err instanceof ScanCanceled;
    const message = err instanceof Error ? err.message : String(err);
    const current = await getScan(scanId);

    await patchScan(scanId, {
      status: canceled ? "canceled" : "error",
      step: canceled ? "canceled" : "error",
      message: canceled ? `中止しました（${savedCount}件まで保存済み）` : message,
      product_count: savedCount,
      finished_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      log: [...(current?.log ?? []), `[${canceled ? "WARNING" : "ERROR"}] ${message}`].slice(-MAX_LOG_LINES),
    });

    await audit("system", canceled ? "discount_scan_canceled" : "discount_scan_error", scanId, {
      message,
      productCount: savedCount,
    });

    if (canceled) return (await getScan(scanId)) as DiscountScanRow;
    throw err;
  }
}
