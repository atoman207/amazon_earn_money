"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { Badge, Card, Empty, SortableTh, Stat, Td, Th } from "@/components/ui";
import { BellIcon, CartCheckIcon, CartIcon, ListIcon, SendIcon } from "@/components/icons";
import {
  DEFAULT_SORT,
  filterByMinRate,
  nextSortState,
  sortDiscountRows,
  summarizeDiscounts,
  toCsv,
  type SortColumn,
  type SortState,
} from "@/lib/domain/discounts";
import type {
  CategoryOption,
  DiscountOption,
  SortOption,
} from "@/lib/server/amazon/catalog";
import type {
  DiscountProductRow,
  DiscountScanRow,
  DiscountScanSummary,
} from "@/lib/supabase/database.types";

interface Props {
  categories: CategoryOption[];
  discounts: DiscountOption[];
  sorts: SortOption[];
  sendMethods: readonly string[];
  sessionReady: boolean;
}

const PER_PAGE = 20;
const POLL_MS = 2500;

const yen = (v: number | null) => (v == null ? "—" : `¥${Math.round(v).toLocaleString("ja-JP")}`);
const rate = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function statusTone(status: DiscountScanRow["status"] | undefined) {
  switch (status) {
    case "queued":
      return { label: "実行待ち", tone: "warn" as const };
    case "running":
      return { label: "実行中", tone: "warn" as const };
    case "success":
      return { label: "完了", tone: "good" as const };
    case "canceled":
      return { label: "中止", tone: "default" as const };
    case "error":
      return { label: "エラー", tone: "bad" as const };
    default:
      return { label: "待機中", tone: "default" as const };
  }
}

/** ログ1行の色分け（[ERROR] / [SUCCESS] / [WARNING]） */
function logClass(line: string) {
  if (line.includes("[ERROR]") || line.includes("[FAIL]")) return "text-[var(--bad)]";
  if (line.includes("[SUCCESS]") || line.includes("[OK]")) return "text-[var(--good)]";
  if (line.includes("[WARNING]")) return "text-[var(--warn)]";
  return "text-[var(--muted)]";
}

/** 表の見出し。すべての列で並べ替えられる。 */
const SORTABLE_COLUMNS: Array<{ column: SortColumn; label: string; right?: boolean }> = [
  { column: "no", label: "No", right: true },
  { column: "name", label: "商品" },
  { column: "quantity", label: "数量", right: true },
  { column: "reference_price", label: "参考価格", right: true },
  { column: "unit_price", label: "ビジネス価格", right: true },
  { column: "discount_rate", label: "割引率", right: true },
  { column: "discount_amount", label: "割引額", right: true },
];

/** 履歴セレクタの1行 */
function historyLabel(s: DiscountScanSummary) {
  const cats = s.category_labels.length ? s.category_labels.join("、") : "カテゴリ指定なし";
  const short = cats.length > 22 ? `${cats.slice(0, 22)}…` : cats;
  return `${fmtTime(s.created_at)} / ${s.min_discount_rate}%以上 / ${s.product_count}件 / ${short}`;
}

export function DiscountConsole({
  categories,
  discounts,
  sorts,
  sendMethods,
  sessionReady,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [discount, setDiscount] = useState<number | "">("");
  const [sortValue, setSortValue] = useState("business_discount_desc");

  const [scan, setScan] = useState<DiscountScanRow | null>(null);
  const [products, setProducts] = useState<DiscountProductRow[]>([]);
  const [history, setHistory] = useState<DiscountScanSummary[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [minRateFilter, setMinRateFilter] = useState(0);
  const [page, setPage] = useState(0);

  const [cartAsins, setCartAsins] = useState<string[]>([]);
  const [cartBusy, setCartBusy] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);

  const [logOpen, setLogOpen] = useState(false);
  /** 終了したときに出す知らせ。閉じるまで残す。 */
  const [finished, setFinished] = useState<DiscountScanRow | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  /** 直前に見た状態。実行中→終了 の切り替わりを捉えるために持つ。 */
  const prevStatusRef = useRef<DiscountScanRow["status"] | null>(null);

  const active = scan?.status === "running" || scan?.status === "queued";
  // scan?.log ?? [] を直に使うと毎回新しい配列になり、下の useMemo が無駄に走る
  const logLines = useMemo(() => scan?.log ?? [], [scan?.log]);

  /**
   * 状態を取りに行く自己スケジュール型のループ。
   * 実行中は短い間隔、待機中は長い間隔にして無駄な問い合わせを減らす。
   * pollNonce を進めると、その場でもう一度取りに行く。
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const url = viewId ? `/api/discounts/scan?id=${viewId}` : "/api/discounts/scan";
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as {
          ok: boolean;
          scan: DiscountScanRow | null;
          products: DiscountProductRow[];
          scans: DiscountScanSummary[];
          cartAsins: string[];
        };
        if (!cancelled && json.ok) {
          const next = json.scan;
          const prev = prevStatusRef.current;
          const wasActive = prev === "running" || prev === "queued";
          const nowDone =
            next?.status === "success" || next?.status === "error" || next?.status === "canceled";

          setScan(next);
          setProducts(json.products ?? []);
          setHistory(json.scans ?? []);
          setCartAsins(json.cartAsins ?? []);

          // 実行を見ていた画面だけに知らせる（開いた直後に過去の結果で出さない）
          if (wasActive && nowDone && next) setFinished(next);
          prevStatusRef.current = next?.status ?? null;

          activeRef.current = next?.status === "running" || next?.status === "queued";
        }
      } catch {
        /* 一時的な失敗は次の周期で取り直す */
      }
      if (!cancelled) {
        timer = setTimeout(tick, activeRef.current ? POLL_MS : POLL_MS * 6);
      }
    };

    timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollNonce, viewId]);

  useEffect(() => {
    if (active) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [scan?.log, active]);

  const toggleCategory = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };


  const canStart =
    !starting && !active && sessionReady && selectedIds.length > 0 && discount !== "" && Boolean(sortValue);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/discounts/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryIds: selectedIds,
          minDiscountRate: discount,
          sortValue,
          // 送信先は選ばせず、終わったら常に全部へ送る
          sendMethods,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; scan?: DiscountScanRow };
      if (!json.ok) throw new Error(json.error ?? "スキャンを開始できませんでした");
      setScan(json.scan ?? null);
      setProducts([]);
      setPage(0);
      setViewId(null); // 新しい実行を追いかける
      activeRef.current = true;
      setPollNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "スキャンを開始できませんでした");
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!scan) return;
    setError(null);
    setCanceling(true);
    try {
      const res = await fetch(`/api/discounts/scan?id=${scan.id}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "中止できませんでした");
      setPollNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "中止できませんでした");
    } finally {
      setCanceling(false);
    }
  };

  /** 見出しを押したときの並べ替え。同じ列なら向きを反転する。 */
  const applySort = (column: SortColumn) => {
    setSort((current) => nextSortState(current, column));
    setPage(0);
  };

  /** 一覧の1行をカートへ。値段はサーバーが DB から読み直すので id だけ送る。 */
  const addToCart = async (product: DiscountProductRow) => {
    setError(null);
    setCartBusy(product.id);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "カートに入れられませんでした");
      setCartAsins((prev) => (prev.includes(product.asin) ? prev : [...prev, product.asin]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "カートに入れられませんでした");
    } finally {
      setCartBusy(null);
    }
  };

  // 保存済みの結果を、見たい順・見たい下限で並べ替える
  const visible = useMemo(
    () => sortDiscountRows(filterByMinRate(products, minRateFilter), sort),
    [products, minRateFilter, sort],
  );

  const summary = useMemo(() => summarizeDiscounts(visible), [visible]);

  /** 知らせに載せる上位5件。送信内容（割引率が高い順の5件）と合わせる。 */
  const topFive = useMemo(
    () =>
      sortDiscountRows(products, { column: "discount_rate", direction: "desc" }).slice(0, 5),
    [products],
  );

  /** 実行ログのうち、送信結果の行だけ */
  const notifyLines = useMemo(
    () => logLines.filter((line) => /送信|ChatWork|Slack|LINE/.test(line)),
    [logLines],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  // 実行中は件数が増え続け、絞り込みで減ることもある。行き先が消えたら最後のページに寄せる。
  const currentPage = Math.min(page, pageCount - 1);
  const shown = useMemo(
    () => visible.slice(currentPage * PER_PAGE, (currentPage + 1) * PER_PAGE),
    [visible, currentPage],
  );

  const downloadCsv = () => {
    // BOM を付けて Excel が文字化けしないようにする
    const blob = new Blob(["﻿", toCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `discounts_${(scan?.created_at ?? new Date().toISOString()).slice(0, 16).replace(/[-:T]/g, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const st = statusTone(scan?.status);

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_1fr]">
      {/* ───────── 設定パネル ───────── */}
      <div className="space-y-4">
        <Card
          title="検索条件"
          action={
            <span className="flex items-center gap-1.5">
              <Badge tone={st.tone}>{st.label}</Badge>
            </span>
          }
        >
          {!sessionReady && (
            <p className="mb-3 rounded-md border border-[var(--warn)]/25 bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
              Amazonビジネスのセッションが未保存です。
              <a href="/settings" className="ml-1 underline">
                設定画面
              </a>
              からログインして保存してください。
            </p>
          )}

          {/* カテゴリ */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--ink-soft)]">カテゴリ</label>
              <span className="text-[11px] text-[var(--muted)]">
                {selectedIds.length}/{categories.length} 選択
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--line)]">
              {categories.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[var(--surface-2)]"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(c.id)}
                    onChange={() => toggleCategory(c.id)}
                    className="accent-[var(--accent)]"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          {/* 割引率 */}
          <div className="mt-3">
            <label className="mb-1.5 block text-xs font-semibold text-[var(--ink-soft)]">
              ビジネス割引（この率以上）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {discounts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDiscount(d.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                    discount === d.value
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">
              取得後にも同じ率で選別するので、Amazon側の絞り込みが効かなかった商品は保存しません。
            </p>
          </div>

          {/* 並べ替え */}
          <div className="mt-3">
            <label
              htmlFor="sortValue"
              className="mb-1.5 block text-xs font-semibold text-[var(--ink-soft)]"
            >
              Amazon側の並べ替え順
            </label>
            <select
              id="sortValue"
              className="field"
              value={sortValue}
              onChange={(e) => setSortValue(e.target.value)}
            >
              {sorts.map((s) => (
                <option key={s.id} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {sortValue !== "business_discount_desc" && (
              <p className="mt-1.5 text-[11px] text-[var(--warn)]">
                割引率の高い商品から確実に拾うなら「ビジネス割引: 降順」を選んでください。
                Amazonが返す順にスクロールして取るため、この設定だと高割引が後回しになります。
              </p>
            )}
          </div>

          {/* 通知（自動送信） */}
          <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
              <SendIcon size={14} className="text-[#0a7a4c]" />
              検索が終わったら自動送信
            </span>
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              割引率が高い上位5件を {sendMethods.join(" / ")} へ送ります。
              設定していない送信先は飛ばします（実行ログに残ります）。
            </p>
          </div>

          {active ? (
            <button
              type="button"
              onClick={cancel}
              disabled={canceling}
              className="btn mt-4 w-full"
            >
              {canceling ? "中止しています…" : "実行を中止する"}
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className="btn btn-primary mt-4 w-full"
            >
              {starting ? "開始しています…" : "割引商品を検索する"}
            </button>
          )}

          {error && (
            <p className="mt-2 rounded-md border border-[var(--bad)]/25 bg-[var(--bad-soft)] px-3 py-2 text-xs text-[var(--bad)]">
              {error}
            </p>
          )}
        </Card>
      </div>

      {/* ───────── 実行状況と結果 ───────── */}
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="表示中の件数"
            value={`${summary.count}件`}
            sub={visible.length === products.length ? undefined : `全${products.length}件中`}
          />
          <Stat
            label="最高割引率"
            value={rate(summary.maxRate)}
            sub={summary.medianRate != null ? `中央値 ${rate(summary.medianRate)}` : undefined}
            tone={summary.maxRate != null ? "good" : "default"}
          />
          <Stat label="割引額の合計" value={yen(summary.totalSaving)} />
          <Stat
            label="最終実行"
            value={fmtTime(scan?.finished_at ?? scan?.started_at ?? null)}
            sub={scan?.step ?? undefined}
          />
        </div>

        {/* 実行状況の1行。ログは場所を取るのでモーダルへ追い出す。 */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
            {scan?.message ?? (active ? (scan?.step ?? "実行中です…") : "待機中")}
          </span>
          <button type="button" className="btn shrink-0 px-2.5 py-1 text-xs" onClick={() => setLogOpen(true)}>
            <ListIcon size={14} className="text-[#0e7490]" />
            ログ表示
            {logLines.length > 0 && (
              <span className="text-[var(--muted)]">（{logLines.length}行）</span>
            )}
          </button>
        </div>

        {/* 結果テーブル */}
        <Card title="割引商品">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              aria-label="表示するスキャン"
              className="field field-inline min-w-0 flex-1 text-sm"
              value={viewId ?? scan?.id ?? ""}
              onChange={(e) => {
                setViewId(e.target.value || null);
                setPage(0);
              }}
            >
              {history.length === 0 && <option value="">履歴なし</option>}
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {historyLabel(h)}
                </option>
              ))}
            </select>
            <select
              aria-label="割引率でさらに絞り込む"
              className="field field-inline text-sm"
              value={minRateFilter}
              onChange={(e) => {
                setMinRateFilter(Number(e.target.value));
                setPage(0);
              }}
            >
              <option value={0}>絞り込みなし</option>
              {discounts.map((d) => (
                <option key={d.id} value={d.value}>
                  {d.label}以上
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn shrink-0"
              onClick={downloadCsv}
              disabled={visible.length === 0}
            >
              CSV
            </button>
            <a href="/cart" className="btn shrink-0 whitespace-nowrap">
              カート {cartAsins.length}件
            </a>
          </div>
          {visible.length === 0 ? (
            <Empty>
              {active
                ? "検索しています。見つかったものから順にここへ出ます。"
                : products.length > 0
                  ? "絞り込みに合う商品がありません。割引率の条件をゆるめてください。"
                  : "まだ結果がありません。左の条件を選んで「割引商品を検索する」を押してください。"}
            </Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="row-hover w-full min-w-[880px]">
                  <thead>
                    <tr>
                      {SORTABLE_COLUMNS.map((col) => (
                        <SortableTh
                          key={col.column}
                          right={col.right}
                          active={sort.column === col.column}
                          direction={sort.direction}
                          onSort={() => applySort(col.column)}
                        >
                          {col.label}
                        </SortableTh>
                      ))}
                      <Th right>
                        <span className="flex items-center justify-end gap-1">
                          <CartIcon size={14} className="text-[#7c3aed]" />
                          カート
                        </span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.id}>
                        <Td right className="text-xs text-[var(--muted)]">
                          {p.no}
                        </Td>
                        <Td>
                          <div className="flex items-start gap-2">
                            {p.image_url ? (
                              <Image
                                src={p.image_url}
                                alt=""
                                width={40}
                                height={40}
                                className="h-10 w-10 shrink-0 rounded border border-[var(--line)] bg-white object-contain"
                                unoptimized
                              />
                            ) : (
                              <span className="h-10 w-10 shrink-0 rounded border border-dashed border-[var(--line)]" />
                            )}
                            <div className="min-w-0">
                              <a
                                href={p.product_url ?? `https://www.amazon.co.jp/dp/${p.asin}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="line-clamp-2 text-xs text-[var(--ink)] hover:underline"
                                title={p.name}
                              >
                                {p.name}
                              </a>
                              <span className="num text-[11px] text-[var(--muted)]">{p.asin}</span>
                            </div>
                          </div>
                        </Td>
                        <Td right className="text-xs">
                          {p.quantity ?? "—"}
                        </Td>
                        <Td right className="text-xs text-[var(--muted)] line-through">
                          {yen(p.reference_price)}
                        </Td>
                        <Td right className="text-xs font-semibold">
                          {yen(p.unit_price)}
                        </Td>
                        <Td right>
                          <Badge tone="good">{rate(p.discount_rate)}</Badge>
                        </Td>
                        <Td right className="text-xs font-semibold text-[var(--good)]">
                          {yen(p.discount_amount)}
                        </Td>
                        <Td right>
                          {(() => {
                            const inCart = cartAsins.includes(p.asin);
                            const busy = cartBusy === p.id;
                            const label = busy
                              ? "追加中"
                              : inCart
                                ? "カートにあります"
                                : "カートに入れる";
                            return (
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => addToCart(p)}
                                  disabled={busy || inCart}
                                  aria-label={label}
                                  title={label}
                                  className={`btn inline-flex h-8 w-8 shrink-0 items-center justify-center p-0 ${
                                    inCart
                                      ? "border-[var(--good)]/30 bg-[var(--good-soft)] text-[var(--good)]"
                                      : "btn-primary"
                                  }`}
                                >
                                  {inCart ? (
                                    <CartCheckIcon size={16} className="shrink-0" />
                                  ) : (
                                    <CartIcon size={16} className="shrink-0" />
                                  )}
                                </button>
                              </div>
                            );
                          })()}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPage(Math.max(0, currentPage - 1))}
                    disabled={currentPage === 0}
                  >
                    前へ
                  </button>
                  <span className="text-[var(--muted)]">
                    {currentPage * PER_PAGE + 1}–
                    {Math.min((currentPage + 1) * PER_PAGE, visible.length)} / {visible.length}件
                  </span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                    disabled={currentPage >= pageCount - 1}
                  >
                    次へ
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* ───────── 実行ログ（モーダル） ───────── */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title={
          <span className="flex items-center gap-1.5">
            <ListIcon size={16} className="text-[#0e7490]" />
            実行ログ
            <span className="font-sans text-xs font-normal text-[var(--muted)]">
              {scan?.step ? `（${scan.step}）` : ""}
            </span>
          </span>
        }
        footer={
          <button type="button" className="btn" onClick={() => setLogOpen(false)}>
            閉じる
          </button>
        }
      >
        <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-[11px] leading-relaxed">
          {logLines.length === 0 ? (
            <p className="text-[var(--muted)]">まだログはありません。</p>
          ) : (
            logLines.map((line, i) => (
              <div key={i} className={logClass(line)}>
                {line}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </Modal>

      {/* ───────── 検索終了の知らせ（モーダル） ───────── */}
      <Modal
        open={finished !== null}
        onClose={() => setFinished(null)}
        title={
          <span className="flex items-center gap-1.5">
            <BellIcon size={16} className="text-[#c2410c]" />
            {finished?.status === "success"
              ? "検索が終わりました"
              : finished?.status === "canceled"
                ? "検索を中止しました"
                : "検索が失敗しました"}
          </span>
        }
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setFinished(null);
                setLogOpen(true);
              }}
            >
              <ListIcon size={15} className="text-[#0e7490]" />
              ログを見る
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setFinished(null)}>
              結果を見る
            </button>
          </>
        }
      >
        {finished && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--ink-soft)]">{finished.message ?? "終了しました。"}</p>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-[var(--line)] px-2 py-2">
                <div className="text-[11px] text-[var(--muted)]">取得件数</div>
                <div className="num text-lg font-bold">{products.length}件</div>
              </div>
              <div className="rounded-md border border-[var(--line)] px-2 py-2">
                <div className="text-[11px] text-[var(--muted)]">最高割引率</div>
                <div className="num text-lg font-bold text-[var(--good)]">
                  {rate(summary.maxRate)}
                </div>
              </div>
              <div className="rounded-md border border-[var(--line)] px-2 py-2">
                <div className="text-[11px] text-[var(--muted)]">割引額の合計</div>
                <div className="num text-lg font-bold">{yen(summary.totalSaving)}</div>
              </div>
            </div>

            {topFive.length > 0 && (
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
                  <SendIcon size={14} className="text-[#0a7a4c]" />
                  送信した上位5件（割引率が高い順）
                </h3>
                <ol className="space-y-1.5">
                  {topFive.map((p, i) => (
                    <li
                      key={p.id}
                      className="flex items-start gap-2 rounded-md border border-[var(--line)] px-2.5 py-2"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--good-soft)] text-[11px] font-bold text-[var(--good)]">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={p.product_url ?? `https://www.amazon.co.jp/dp/${p.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                          title={p.name}
                        >
                          {p.name}
                        </a>
                        <span className="num text-[11px] text-[var(--muted)]">{p.asin}</span>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="num text-xs font-bold text-[var(--good)]">
                          {rate(p.discount_rate)}
                        </div>
                        <div className="num text-[11px] text-[var(--muted)]">
                          {yen(p.discount_amount)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">通知の送信結果</h3>
              {notifyLines.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">送信は行われませんでした。</p>
              ) : (
                <ul className="space-y-1">
                  {notifyLines.map((line, i) => (
                    <li key={i} className={`text-xs ${logClass(line)}`}>
                      {line.replace(/^\[(SUCCESS|WARNING|ERROR)\]\s*/, "")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
