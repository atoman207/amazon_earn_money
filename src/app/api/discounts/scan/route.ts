import { NextResponse } from "next/server";
import {
  normalizeCategoryIds,
  normalizeDiscount,
  normalizeSendMethods,
  normalizeSortValue,
} from "@/lib/server/amazon/catalog";
import { spawnAmazonScript } from "@/lib/server/amazon/run-script";
import { currentUser } from "@/lib/server/auth";
import { listCartAsins } from "@/lib/server/cart";
import { sessionExists } from "@/lib/server/amazon/session";
import {
  createScan,
  failScan,
  getScan,
  hasActiveScan,
  latestScan,
  listScanProducts,
  listScanSummaries,
  requestCancel,
} from "@/lib/server/discountScan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * スキャンの状態・取得結果・履歴を返す。
 * 逐次保存しているので、実行中でもその時点までの商品を返す。
 * ?id= を付けると過去のスキャンを開ける。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  const me = await currentUser();
  const scan = id ? await getScan(id) : await latestScan();
  const [scans, cartAsins] = await Promise.all([
    listScanSummaries(),
    me ? listCartAsins(me.id) : Promise.resolve([]),
  ]);

  if (!scan) {
    return NextResponse.json({ ok: true, scan: null, products: [], scans, cartAsins });
  }

  const products = await listScanProducts(scan.id);
  return NextResponse.json({ ok: true, scan, products, scans, cartAsins });
}

/** スキャンを開始する。実処理は別プロセスへ渡し、すぐに返す。 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const categoryIds = normalizeCategoryIds(body.categoryIds ?? body.category_ids);
  if (categoryIds.length === 0) {
    return NextResponse.json({ ok: false, error: "カテゴリを1つ以上選択してください" }, { status: 400 });
  }

  const minDiscountRate = normalizeDiscount(body.minDiscountRate ?? body.discount);
  if (minDiscountRate === null) {
    return NextResponse.json({ ok: false, error: "割引率を選択してください" }, { status: 400 });
  }

  const sortValue = normalizeSortValue(body.sortValue ?? body.sort);
  if (sortValue === null) {
    return NextResponse.json({ ok: false, error: "並べ替え順を選択してください" }, { status: 400 });
  }

  const sendMethods = normalizeSendMethods(body.sendMethods ?? body.send_methods);

  if (!(await sessionExists())) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Amazonビジネスのセッションが保存されていません。設定画面からログインして保存してください。",
      },
      { status: 409 },
    );
  }

  if (await hasActiveScan()) {
    return NextResponse.json(
      { ok: false, error: "すでに実行中のスキャンがあります。完了までお待ちください。" },
      { status: 409 },
    );
  }

  try {
    const scan = await createScan({ categoryIds, minDiscountRate, sortValue, sendMethods });
    // 子プロセスが起動に失敗しても「実行待ち」のまま放置されないよう、理由を書き戻す
    spawnAmazonScript("amazon-discount-scan.ts", [scan.id], (reason) => failScan(scan.id, reason));
    return NextResponse.json({ ok: true, scan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "スキャンを開始できませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * 実行中のスキャンを中止する。
 * 別プロセスは中止の旗を見て止まり、そこまでに取れた商品は残る。
 */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  const scan = id ? await getScan(id) : await latestScan();
  if (!scan) {
    return NextResponse.json({ ok: false, error: "中止できるスキャンがありません" }, { status: 404 });
  }
  if (scan.status !== "queued" && scan.status !== "running") {
    return NextResponse.json(
      { ok: false, error: "このスキャンはすでに終了しています" },
      { status: 409 },
    );
  }

  const updated = await requestCancel(scan.id);
  return NextResponse.json({ ok: true, scan: updated });
}
