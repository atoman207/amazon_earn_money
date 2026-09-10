import Image from "next/image";
import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { PriceChart } from "@/components/PriceChart";
import { Badge, Callout, Card, Empty, Money, Stat, Th, Td } from "@/components/ui";
import { describeForecast } from "@/lib/domain/forecast";
import { days, pct, stars, yen } from "@/lib/format";
import { notifyQueue } from "@/lib/server/steps/notify";

export const dynamic = "force-dynamic";

async function Queue({ sent, skipped }: { sent: string | null; skipped: string | null }) {
  const view = await notifyQueue();
  const lineReady = view.channels.find((c) => c.name === "LINE")?.configured ?? false;

  return (
    <StepShell
      stepKey="notify"
      sub="queue"
      actions={
        <form action="/api/notify/send" method="post" className="flex items-center gap-2">
          {view.quiet && <input type="hidden" name="force" value="1" />}
          <button className="btn btn-primary" disabled={!lineReady || view.cards.length === 0}>
            {view.quiet ? "静穏時間だが送る" : "いま送る"}
          </button>
        </form>
      }
    >
      {sent && (
        <div className="mb-4">
          <Callout tone="good">{sent}件を送信しました。</Callout>
        </div>
      )}
      {skipped && (
        <div className="mb-4">
          <Callout tone="warn">送信しませんでした（{skipped}）。</Callout>
        </div>
      )}
      {!lineReady && (
        <div className="mb-4">
          <Callout tone="bad" title="LINEへ送れません">
            LINE_CHANNEL_ACCESS_TOKEN / LINE_TO_USER_ID が未設定です。
            設定するまで、送信履歴には「未設定」として記録だけが残ります。
          </Callout>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="通知できる候補"
          value={`${view.pending}件`}
          sub={`1回に送る上限 ${view.notifySettings.topN}件`}
          tone={view.pending > 0 ? "good" : "default"}
        />
        <Stat
          label="今日の送信数"
          value={`${view.sentToday}件`}
          sub={`1日の上限 ${view.notifySettings.dailyLimit}件 / 残り ${view.remaining}件`}
        />
        <Stat
          label="いまの時間帯"
          value={view.quiet ? "静穏時間" : "送信できます"}
          sub={`${view.notifySettings.quietStartHour}時〜${view.notifySettings.quietEndHour}時は送りません`}
          tone={view.quiet ? "warn" : "good"}
        />
        <Stat
          label="送信先"
          value={view.channels.filter((c) => c.configured).length + "/3"}
          sub={view.channels.map((c) => `${c.name}${c.configured ? "○" : "×"}`).join(" ")}
        />
      </div>

      {view.cards.length === 0 ? (
        <div className="mt-4">
          <Empty>
            通知できる候補がありません。②③で条件を満たした商品がここに並びます。
          </Empty>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {view.cards.map((card) => {
            const op = card.opportunity;
            const chart = card.history.map((h) => ({
              date: h.date,
              sell: h.price,
              buy: null,
              offers: null,
            }));
            return (
              <Card
                key={op.id}
                title={card.notified ? "送信済み" : "送信待ち"}
                action={
                  <span className="flex items-center gap-2">
                    <Badge tone={card.notified ? "default" : "accent"}>
                      {card.notified ? "重複は送りません" : "次の送信に含まれます"}
                    </Badge>
                    <Link href={`/purchase/approve#${op.id}`} className="text-xs text-[var(--accent)]">
                      承認へ
                    </Link>
                  </span>
                }
              >
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <div className="flex gap-3">
                      {card.product?.image_url ? (
                        <Image
                          src={card.product.image_url}
                          alt=""
                          width={72}
                          height={72}
                          className="h-18 w-18 shrink-0 rounded-lg border border-[var(--line)] object-contain"
                          unoptimized
                        />
                      ) : (
                        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--line-strong)] text-[10px] text-[var(--muted)]">
                          画像なし
                        </span>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold leading-snug">
                          {card.product?.title ?? op.asin}
                        </h3>
                        <p className="num mt-0.5 text-[11px] text-[var(--muted)]">
                          {op.asin}
                          {card.product?.brand ? ` / ${card.product.brand}` : ""}
                          {card.product?.category ? ` / ${card.product.category}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <div className="text-[11px] text-[var(--muted)]">現在価格</div>
                        <div className="num text-sm font-bold">
                          {yen(card.currentBuyPrice ?? op.buy_price)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--muted)]">仕入上限価格</div>
                        <div className="num text-sm font-bold">
                          {op.max_buy_price == null ? "—" : yen(op.max_buy_price)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--muted)]">推奨購入数量</div>
                        <div className="num text-sm font-bold">{op.suggested_qty}個</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--muted)]">期待利益・ROI</div>
                        <div className="text-sm font-bold">
                          <Money value={Number(op.net_profit)} />
                          <span className="num ml-1 text-xs text-[var(--muted)]">{pct(Number(op.roi))}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <h4 className="mb-1 text-xs font-semibold text-[var(--ink-soft)]">過去価格（1年）</h4>
                      {chart.length < 2 ? (
                        <Empty>価格の記録が足りません</Empty>
                      ) : (
                        <PriceChart
                          data={chart}
                          height={200}
                          acquisitionCost={Number(op.acquisition_cost)}
                          targetPrice={Number(op.expected_sell_price)}
                          stopPrice={
                            op.max_buy_price == null ? null : Math.round(Number(op.acquisition_cost) * 0.9)
                          }
                        />
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-lg border border-[var(--line)] p-3">
                      <h4 className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">価格予測</h4>
                      <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                        {card.forecast
                          ? describeForecast(card.forecast, 30)
                          : "予測に使える価格の記録がありません。"}
                      </p>
                    </div>

                    <div className="rounded-lg border border-[var(--line)] p-3">
                      <h4 className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">リスク情報</h4>
                      <ul className="space-y-1 text-[11px]">
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">データの信頼度</span>
                          <span className="text-[var(--warn)]">{stars(Number(op.confidence))}</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">売れるまで</span>
                          <span className="num">{days(Number(op.expected_days))}</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">競合</span>
                          <span className="num">{op.offer_count}社</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">出品ゲート</span>
                          <span>{op.listing_gate ?? "PASS"}</span>
                        </li>
                      </ul>
                      {op.warnings.length > 0 && (
                        <ul className="mt-2 space-y-0.5 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--warn)]">
                          {op.warnings.map((w) => (
                            <li key={w}>⚠ {w}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                      <h4 className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">
                        実際に送る本文
                      </h4>
                      <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--ink-soft)]">
                        {card.text}
                      </pre>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-4" title="送信の決まり">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr>
                <Th>決まり</Th>
                <Th>いまの値</Th>
                <Th>理由</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="text-xs">静穏時間</Td>
                <Td className="num text-xs">
                  {view.notifySettings.quietStartHour}時〜{view.notifySettings.quietEndHour}時
                </Td>
                <Td className="text-xs text-[var(--muted)]">深夜に通知で起こさないため</Td>
              </tr>
              <tr>
                <Td className="text-xs">1回に送る件数</Td>
                <Td className="num text-xs">{view.notifySettings.topN}件</Td>
                <Td className="text-xs text-[var(--muted)]">まとめて届いても判断できないため</Td>
              </tr>
              <tr>
                <Td className="text-xs">1日の上限</Td>
                <Td className="num text-xs">{view.notifySettings.dailyLimit}件</Td>
                <Td className="text-xs text-[var(--muted)]">通知が多いと見なくなるため</Td>
              </tr>
              <tr>
                <Td className="text-xs">重複</Td>
                <Td className="text-xs">同じ候補は1回だけ</Td>
                <Td className="text-xs text-[var(--muted)]">同じ商品で何度も鳴らさないため</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </StepShell>
  );
}

export default async function Page({ searchParams }: PageProps<"/notify/queue">) {
  const params = await searchParams;
  const sent = typeof params.sent === "string" ? params.sent : null;
  const skipped = typeof params.skipped === "string" ? params.skipped : null;

  return (
    <SetupGuard>
      <Queue sent={sent} skipped={skipped} />
    </SetupGuard>
  );
}
