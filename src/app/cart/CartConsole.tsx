"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckIcon, TargetIcon } from "@/components/icons";
import { Badge, Card, Empty, SortableTh, Stat, Td, Th } from "@/components/ui";
import {
  DEFAULT_SORT,
  nextSortState,
  sortDiscountRows,
  summarizeDiscounts,
  toCsv,
  type SortColumn,
  type SortState,
} from "@/lib/domain/discounts";
import type { CartItemRow } from "@/lib/supabase/database.types";

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

/** 割引一覧と同じ見出し。並べ替えの操作感を揃える。 */
const SORTABLE_COLUMNS: Array<{ column: SortColumn; label: string; right?: boolean }> = [
  { column: "name", label: "商品" },
  { column: "quantity", label: "数量", right: true },
  { column: "reference_price", label: "参考価格", right: true },
  { column: "unit_price", label: "ビジネス価格", right: true },
  { column: "discount_rate", label: "割引率", right: true },
  { column: "discount_amount", label: "割引額", right: true },
];

/**
 * カートに入れた商品の一覧。
 * 並べ替えロジックは割引一覧と共通のものを使う（no は追加順で代用する）。
 */
/** 採算判定の結果。カートの各行に添えて「利益が出るか」を見せる。 */
export interface Judgment {
  judgment: string | null;
  netProfit: number;
  roi: number;
  maxBuyPrice: number | null;
  listingGate: string | null;
  passed: boolean;
  confidence: number;
  expectedDays: number;
  warnings: string[];
}

const JUDGMENT_LABEL: Record<string, { label: string; tone: "good" | "warn" | "bad" | "default" }> = {
  buy: { label: "購入候補", tone: "good" },
  pilot: { label: "少量検証", tone: "warn" },
  review: { label: "要確認", tone: "warn" },
  skip: { label: "見送り", tone: "bad" },
};

export function CartConsole({
  initialItems,
  initialJudgments = {},
}: {
  initialItems: CartItemRow[];
  initialJudgments?: Record<string, Judgment>;
}) {
  const [items, setItems] = useState<CartItemRow[]>(initialItems);
  // 判定はサーバーが作るものなので状態に持たず、props をそのまま映す
  // （router.refresh() で最新に入れ替わる）
  const judgments = initialJudgments;
  const [evaluating, setEvaluating] = useState(false);
  const [evalMessage, setEvalMessage] = useState<string | null>(null);
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 並べ替えは no を必要とするので、追加順（新しいものが先）を no として与える
  const rows = useMemo(
    () => items.map((item, i) => ({ ...item, no: i + 1 })),
    [items],
  );

  const visible = useMemo(() => sortDiscountRows(rows, sort), [rows, sort]);
  const summary = useMemo(() => summarizeDiscounts(visible), [visible]);

  const applySort = (column: SortColumn) => setSort((current) => nextSortState(current, column));

  const remove = async (asin: string) => {
    setError(null);
    setBusy(asin);
    try {
      const res = await fetch(`/api/cart?asin=${encodeURIComponent(asin)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "カートから外せませんでした");
      setItems((prev) => prev.filter((i) => i.asin !== asin));
    } catch (e) {
      setError(e instanceof Error ? e.message : "カートから外せませんでした");
    } finally {
      setBusy(null);
    }
  };

  /** カート全件を採算判定へ載せる（商品マスタ・監視・価格観測を作って利益を計算する） */
  const evaluateAll = async () => {
    setError(null);
    setEvalMessage(null);
    setEvaluating(true);
    try {
      const res = await fetch("/api/cart/evaluate", { method: "POST" });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        total?: number;
        evaluated?: number;
        passed?: number;
      };
      if (!json.ok) throw new Error(json.error ?? "判定できませんでした");
      setEvalMessage(
        `${json.total}件のうち ${json.evaluated}件を判定し、${json.passed}件が条件を満たしました。`,
      );
      // 判定結果はサーバー側で作られるので、読み直して反映する
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定できませんでした");
    } finally {
      setEvaluating(false);
    }
  };

  const downloadCsv = () => {
    const csv = toCsv(visible.map((r, i) => ({ ...r, no: i + 1 })));
    // BOM を付けて Excel が文字化けしないようにする
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cart_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="カートの件数" value={`${summary.count}件`} />
        <Stat
          label="最高割引率"
          value={rate(summary.maxRate)}
          sub={summary.medianRate != null ? `中央値 ${rate(summary.medianRate)}` : undefined}
          tone={summary.maxRate != null ? "good" : "default"}
        />
        <Stat label="割引額の合計" value={yen(summary.totalSaving)} />
        <Stat
          label="仕入額の合計"
          value={yen(visible.reduce((sum, r) => sum + (r.unit_price ?? 0), 0))}
          sub="1個あたりの単価の合計"
        />
      </div>

      <Card title="カートに入れた商品">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary shrink-0"
            onClick={evaluateAll}
            disabled={evaluating || items.length === 0}
          >
            <TargetIcon size={16} />
            {evaluating ? "判定しています…" : "採算を判定する"}
          </button>
          <Link href="/collect/discounts" className="btn shrink-0">
            割引検索へ戻る
          </Link>
          <button
            type="button"
            className="btn shrink-0"
            onClick={downloadCsv}
            disabled={visible.length === 0}
          >
            CSV
          </button>
          <span className="text-xs text-[var(--muted)]">
            カートに入れると商品マスタ・監視リストへ登録し、手数料込みの利益を計算します。
          </span>
        </div>

        {error && (
          <p className="mb-3 rounded-md border border-[var(--bad)]/25 bg-[var(--bad-soft)] px-3 py-2 text-xs text-[var(--bad)]">
            {error}
          </p>
        )}
        {evalMessage && (
          <p className="mb-3 flex items-center gap-1.5 rounded-md border border-[var(--good)]/25 bg-[var(--good-soft)] px-3 py-2 text-xs text-[var(--good)]">
            <CheckIcon size={14} />
            {evalMessage}
          </p>
        )}

        {visible.length === 0 ? (
          <Empty>
            まだ何も入っていません。
            <Link href="/collect/discounts" className="ml-1 underline">
              割引検索
            </Link>
            で見つけた商品を「カートに入れる」で追加してください。
          </Empty>
        ) : (
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
                  <Th>採算判定</Th>
                  <Th right>追加</Th>
                  <Th right> </Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <Td>
                      <div className="flex items-start gap-2">
                        {item.image_url ? (
                          <Image
                            src={item.image_url}
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
                            href={item.product_url ?? `https://www.amazon.co.jp/dp/${item.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-2 text-xs text-[var(--ink)] hover:underline"
                            title={item.name}
                          >
                            {item.name}
                          </a>
                          <span className="num text-[11px] text-[var(--muted)]">{item.asin}</span>
                        </div>
                      </div>
                    </Td>
                    <Td right className="text-xs">
                      {item.quantity ?? "—"}
                    </Td>
                    <Td right className="text-xs text-[var(--muted)] line-through">
                      {yen(item.reference_price)}
                    </Td>
                    <Td right className="text-xs font-semibold">
                      {yen(item.unit_price)}
                    </Td>
                    <Td right>
                      <Badge tone="good">{rate(item.discount_rate)}</Badge>
                    </Td>
                    <Td right className="text-xs font-semibold text-[var(--good)]">
                      {yen(item.discount_amount)}
                    </Td>
                    <Td>
                      {(() => {
                        const j = judgments[item.asin];
                        if (!j) {
                          return (
                            <span className="text-[11px] text-[var(--muted)]">未判定</span>
                          );
                        }
                        const label = JUDGMENT_LABEL[j.judgment ?? ""] ?? {
                          label: j.passed ? "条件を満たす" : "条件を満たさない",
                          tone: j.passed ? ("good" as const) : ("default" as const),
                        };
                        return (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <Badge tone={label.tone}>{label.label}</Badge>
                              {j.listingGate && j.listingGate !== "PASS" && (
                                <Badge tone="warn">{`出品${j.listingGate}`}</Badge>
                              )}
                            </div>
                            <div className="num text-[11px] text-[var(--muted)]">
                              利益 {yen(j.netProfit)} / ROI {(j.roi * 100).toFixed(1)}%
                            </div>
                            <div className="num text-[11px] text-[var(--muted)]">
                              仕入上限 {yen(j.maxBuyPrice)}
                            </div>
                          </div>
                        );
                      })()}
                    </Td>
                    <Td right className="text-xs text-[var(--muted)]">
                      {fmtTime(item.added_at)}
                    </Td>
                    <Td right>
                      <button
                        type="button"
                        onClick={() => remove(item.asin)}
                        disabled={busy === item.asin}
                        className="btn shrink-0 whitespace-nowrap px-2 py-1 text-[11px]"
                      >
                        {busy === item.asin ? "外しています…" : "外す"}
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
