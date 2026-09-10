import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat } from "@/components/ui";
import { days, pct, stars, yen } from "@/lib/format";
import { approvalQueue } from "@/lib/server/steps/purchase";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  gate: "出品ゲートが PASS ではないため、承認できませんでした。",
  stock: "在庫切れのため中止しました。",
  drift: "承認したときから価格が動いたため中止しました。もう一度確かめてください。",
  maxbuy: "現在価格が仕入上限を超えたため中止しました。",
};

const SKIP_REASONS = [
  ["price_change", "価格変化"],
  ["profit_low", "利益不足"],
  ["competition", "競合"],
  ["evidence_weak", "販売根拠不足"],
  ["restriction", "制限・証憑"],
  ["capital", "資金不足"],
  ["mismatch", "商品不一致"],
  ["other", "その他"],
] as const;

async function Approve({ err }: { err: string | null }) {
  const view = await approvalQueue();
  const mode = view.settings.operation.purchaseMode;
  const ready = view.cards.filter((c) => !c.blocked);

  return (
    <StepShell stepKey="purchase" sub="approve">
      {err && ERROR_MESSAGE[err] && (
        <div className="mb-4">
          <Callout tone="bad">{ERROR_MESSAGE[err]}</Callout>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="承認待ち" value={`${view.cards.length}件`} tone={view.cards.length ? "good" : "default"} />
        <Stat label="いま承認できる" value={`${ready.length}件`} sub="発注直前の確認に通るもの" />
        <Stat label="必要な資金" value={yen(view.totalCost)} sub="推奨数量で全部買った場合" />
        <Stat
          label="購入モード"
          value={mode === "A" ? "A：手動" : mode === "B" ? "B：承認購入" : "C：全自動"}
          sub={mode === "C" && !view.settings.operation.autoModeEnabled ? "全自動は無効です" : undefined}
        />
      </div>

      <div className="mt-4">
        <Callout>
          購入するのは<span className="font-bold">お客様のAmazonアカウント</span>です。
          この画面の「購入する」は、注文したことをシステムに記録して在庫として追い始めるための操作で、
          押した瞬間に価格・在庫・仕入上限をもう一度確かめ、外れていれば止めます。
          注文番号と実支払額を入れておくと、⑧の答え合わせが正確になります。
        </Callout>
      </div>

      {view.cards.length === 0 ? (
        <div className="mt-4">
          <Empty>承認待ちの候補はありません。②③で条件を満たした商品がここに並びます。</Empty>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {view.cards.map((card) => {
            const op = card.opportunity;
            return (
              <article
                key={op.id}
                id={op.id}
                className="scroll-mt-20 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"
              >
                <header className="border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={card.blocked ? "bad" : "good"}>
                      {card.blocked ? "いまは承認できません" : "承認できます"}
                    </Badge>
                    <span className="text-xs text-[var(--muted)]">
                      信頼度 <span className="text-[var(--warn)]">{stars(Number(op.confidence))}</span>
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold leading-snug">
                    {card.product?.title ?? op.asin}
                  </h3>
                  <p className="num mt-0.5 text-[11px] text-[var(--muted)]">
                    {op.asin}
                    {card.product?.category ? ` / ${card.product.category}` : ""}
                  </p>
                </header>

                <div className="grid grid-cols-3 divide-x divide-[var(--line)] border-b border-[var(--line)]">
                  <div className="px-3 py-3 text-center">
                    <div className="text-[11px] text-[var(--muted)]">純利益（1個）</div>
                    <div className="mt-0.5 text-lg font-bold">
                      <Money value={Number(op.net_profit)} />
                    </div>
                  </div>
                  <div className="px-3 py-3 text-center">
                    <div className="text-[11px] text-[var(--muted)]">ROI</div>
                    <div className="num mt-0.5 text-lg font-bold">{pct(Number(op.roi))}</div>
                  </div>
                  <div className="px-3 py-3 text-center">
                    <div className="text-[11px] text-[var(--muted)]">売れるまで</div>
                    <div className="num mt-0.5 text-lg font-bold">{days(Number(op.expected_days))}</div>
                  </div>
                </div>

                <dl className="divide-y divide-[var(--line)]/60 px-4 text-sm">
                  <div className="flex justify-between py-2">
                    <dt className="text-[var(--muted)]">承認時の価格</dt>
                    <dd className="num">{yen(op.buy_price)}</dd>
                  </div>
                  <div className="flex justify-between py-2">
                    <dt className="text-[var(--muted)]">いまの価格</dt>
                    <dd className="num">
                      {card.currentBuyPrice === null ? "未取得" : yen(card.currentBuyPrice)}
                      {card.drift !== null && card.drift > 0.005 && (
                        <span className={`ml-1 text-xs ${card.drift > 0.03 ? "text-[var(--bad)]" : "text-[var(--muted)]"}`}>
                          （{pct(card.drift, 1)} 動いています）
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between py-2">
                    <dt className="text-[var(--muted)]">仕入上限</dt>
                    <dd className="num">{op.max_buy_price == null ? "—" : yen(op.max_buy_price)}</dd>
                  </div>
                  <div className="flex justify-between py-2">
                    <dt className="text-[var(--muted)]">推奨数量</dt>
                    <dd className="num">{op.suggested_qty}個</dd>
                  </div>
                  <div className="flex justify-between py-2">
                    <dt className="text-[var(--muted)]">合計（推奨数量ぶん）</dt>
                    <dd className="num">{yen(Number(op.acquisition_cost) * op.suggested_qty)}</dd>
                  </div>
                </dl>

                {card.blocked && (
                  <div className="border-t border-[var(--line)] bg-[var(--bad-soft)] px-4 py-2 text-xs text-[var(--bad)]">
                    {card.blocked}
                  </div>
                )}

                <div className="space-y-2 border-t border-[var(--line)] p-3">
                  <form
                    action={`/api/opportunities/${op.id}/decide`}
                    method="post"
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <input type="hidden" name="action" value="approve" />
                    <label className="block text-xs text-[var(--muted)]">
                      購入数量
                      <input
                        name="qty"
                        type="number"
                        min={1}
                        max={op.suggested_qty}
                        defaultValue={op.suggested_qty}
                        className="field num mt-1"
                      />
                    </label>
                    <label className="block text-xs text-[var(--muted)]">
                      Amazon注文番号（任意）
                      <input name="amazonOrderId" className="field mt-1" placeholder="例: 123-1234567-1234567" />
                    </label>
                    <label className="block text-xs text-[var(--muted)] sm:col-span-2">
                      実支払額（任意・1個あたり）
                      <input name="actualPaid" type="number" className="field num mt-1" placeholder="円" />
                    </label>
                    <button className="btn btn-primary sm:col-span-2" disabled={Boolean(card.blocked)}>
                      承認して購入を記録する
                    </button>
                  </form>

                  <form
                    action={`/api/opportunities/${op.id}/decide`}
                    method="post"
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="action" value="skip" />
                    <label className="min-w-[10rem] flex-1 text-xs text-[var(--muted)]">
                      見送り理由
                      <select name="skipReasonCode" className="field mt-1" defaultValue="other">
                        {SKIP_REASONS.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn">見送る</button>
                    <Link
                      href={`/products/${op.asin}`}
                      className="flex items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--muted)]"
                    >
                      詳細
                    </Link>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Card className="mt-4" title="承認したあとに起きること">
        <ol className="space-y-1.5 text-xs text-[var(--muted)]">
          <li>1. 価格・在庫・仕入上限を再確認します（3%以上動いていたら止めます）。</li>
          <li>2. 発注として記録し、在庫（ポジション）を作ります。目標価格と損切りラインもここで決まります。</li>
          <li>3. ⑥の在庫管理に並び、毎日の出口判定の対象になります。</li>
        </ol>
      </Card>
    </StepShell>
  );
}

export default async function Page({ searchParams }: PageProps<"/purchase/approve">) {
  const params = await searchParams;
  const err = typeof params.err === "string" ? params.err : null;

  return (
    <SetupGuard>
      <Approve err={err} />
    </SetupGuard>
  );
}
