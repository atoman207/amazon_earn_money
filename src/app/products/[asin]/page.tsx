import { notFound } from "next/navigation";
import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { Shell } from "@/components/Shell";
import { PriceChart } from "@/components/PriceChart";
import { Badge, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { dateTime, days, pct, yen } from "@/lib/format";
import { priceSeries } from "@/lib/server/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { summarizeHistory } from "@/lib/server/pipeline";
import { backtestAsin } from "@/lib/server/backtest";
import { DEFAULT_BACKTEST_PARAMS, type ExitReason } from "@/lib/domain/backtest";
import type { PriceObservationRow } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/** バックテストの手仕舞い理由の表示名 */
const EXIT_LABEL: Record<ExitReason, string> = {
  target: "利確",
  stop_loss: "損切り",
  time_stop: "時間切れ",
  open: "未決",
};

async function Detail({ asin }: { asin: string }) {
  const db = supabaseAdmin();
  const { data: product } = await db.from("products").select("*").eq("asin", asin).maybeSingle();
  if (!product) notFound();

  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const [series, obsRes, opsRes] = await Promise.all([
    priceSeries(asin, 365),
    db
      .from("price_observations")
      .select("*")
      .eq("asin", asin)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(8000),
    db
      .from("opportunities")
      .select("*")
      .eq("asin", asin)
      .order("detected_at", { ascending: false })
      .limit(10),
  ]);

  const stats = summarizeHistory((obsRes.data ?? []) as PriceObservationRow[]);
  const opportunities = opsRes.data ?? [];

  // 過去の観測で「この条件で買っていたらどうだったか」を検証する
  const backtestParams = DEFAULT_BACKTEST_PARAMS;
  const bt = await backtestAsin(asin, 365, backtestParams);

  return (
    <Shell
      title={product.title}
      actions={
        <Link href="/purchase/approve" className="text-sm text-[var(--accent)]">
          候補一覧
        </Link>
      }
    >
      <p className="mb-4 text-xs text-[var(--muted)]">
        {product.asin} / {product.category}
        {product.brand ? ` / ${product.brand}` : ""}
      </p>
      {product.restricted && (
        <div className="mb-4 rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-4 py-3 text-sm text-[var(--bad)]">
          この商品は出品制限・要確認カテゴリです（{product.restricted_reason ?? "理由未設定"}）。
          候補には出しません。
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="30日中央値" value={stats.median30 === null ? "—" : yen(stats.median30)} />
        <Stat label="90日中央値" value={stats.median90 === null ? "—" : yen(stats.median90)} />
        <Stat label="180日中央値" value={stats.median180 === null ? "—" : yen(stats.median180)} />
        <Stat label="365日中央値" value={stats.median365 === null ? "—" : yen(stats.median365)} />
        <Stat label="90日最安値" value={stats.min90 === null ? "—" : yen(stats.min90)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="値動きの荒さ" value={pct(stats.volatility)} sub="標準偏差 / 平均" />
        <Stat label="1日あたり販売数" value={stats.salesPerDay.toFixed(2)} sub="ランキング推移から推定" />
        <Stat label="競合出品者" value={`${stats.baselineOfferCount}社`} sub={`履歴 ${days(stats.historyDays)}`} />
      </div>

      <Card
        className="mt-4"
        title="バックテスト（過去365日）"
        action={
          <span className="text-xs text-[var(--muted)]">
            {`下落${(backtestParams.minDiscountRate * 100).toFixed(0)}%で買い / 利確+${(backtestParams.targetProfitRate * 100).toFixed(0)}% / 損切り${(backtestParams.stopLossRate * 100).toFixed(0)}% / ${backtestParams.timeStopDays}日`}
          </span>
        }
      >
        {bt.closed === 0 ? (
          <Empty>
            決着した取引がまだありません（観測 {bt.sampleCount}件 / {days(bt.coverageDays)}）。
            価格の取り込みが進むと、この条件で買っていた場合の成績が出ます。
          </Empty>
        ) : (
          <>
            {!bt.reliable && (
              <p className="mb-3 rounded-md border border-[var(--warn)]/25 bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
                標本が少ないため参考値です（決着 {bt.closed}件 / {days(bt.coverageDays)}）。
                5件・180日を超えると信頼できる目安になります。
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat
                label="勝率"
                value={bt.winRate === null ? "—" : pct(bt.winRate, 0)}
                sub={`決着 ${bt.closed}件 / 未決 ${bt.open}件`}
                tone={bt.winRate !== null && bt.winRate >= 0.6 ? "good" : "default"}
              />
              <Stat
                label="平均利益率"
                value={bt.avgRoi === null ? "—" : pct(bt.avgRoi)}
                tone={bt.avgRoi !== null && bt.avgRoi > 0 ? "good" : "bad"}
              />
              <Stat label="平均保有日数" value={days(bt.avgHoldingDays)} />
              <Stat
                label="最大損失"
                value={bt.maxLoss === null ? "—" : yen(bt.maxLoss)}
                sub={bt.avgLoss === null ? undefined : `平均 ${yen(bt.avgLoss)}`}
                tone={bt.maxLoss === null ? "default" : "bad"}
              />
              <Stat
                label="Profit Factor"
                value={bt.profitFactor === null ? "—" : bt.profitFactor.toFixed(2)}
                sub={`累計 ${yen(bt.totalProfit)}`}
                tone={bt.profitFactor !== null && bt.profitFactor >= 1 ? "good" : "bad"}
              />
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="row-hover w-full min-w-[620px]">
                <thead>
                  <tr>
                    <Th>買った日</Th>
                    <Th right>仕入</Th>
                    <Th>売った日</Th>
                    <Th right>売値</Th>
                    <Th right>保有</Th>
                    <Th right>損益</Th>
                    <Th>理由</Th>
                  </tr>
                </thead>
                <tbody>
                  {bt.trades.slice(0, 10).map((t) => (
                    <tr key={t.entryAt}>
                      <Td className="text-xs">{dateTime(t.entryAt)}</Td>
                      <Td right className="text-xs">
                        {yen(t.buyPrice)}
                      </Td>
                      <Td className="text-xs">{t.exitAt ? dateTime(t.exitAt) : "—"}</Td>
                      <Td right className="text-xs">
                        {t.exitPrice === null ? "—" : yen(t.exitPrice)}
                      </Td>
                      <Td right className="text-xs">
                        {days(t.holdingDays)}
                      </Td>
                      <Td
                        right
                        className={`text-xs font-semibold ${
                          t.netProfit > 0
                            ? "text-[var(--good)]"
                            : t.netProfit < 0
                              ? "text-[var(--bad)]"
                              : ""
                        }`}
                      >
                        {t.exitReason === "open" ? "—" : yen(t.netProfit)}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            t.exitReason === "target"
                              ? "good"
                              : t.exitReason === "stop_loss"
                                ? "bad"
                                : "default"
                          }
                        >
                          {EXIT_LABEL[t.exitReason]}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card className="mt-4" title="価格の推移（365日）">
        {series.length === 0 ? <Empty>価格履歴がまだありません</Empty> : <PriceChart data={series} height={320} />}
      </Card>

      <Card className="mt-4" title="検知履歴">
        {opportunities.length === 0 ? (
          <Empty>まだ検知していません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[720px]">
              <thead>
                <tr>
                  <Th>検知</Th>
                  <Th right>仕入</Th>
                  <Th right>想定売価</Th>
                  <Th right>純利益</Th>
                  <Th right>利益率</Th>
                  <Th>結果</Th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o) => (
                  <tr key={o.id}>
                    <Td className="text-xs text-[var(--muted)]">{dateTime(o.detected_at)}</Td>
                    <Td right>{yen(o.buy_price)}</Td>
                    <Td right>{yen(o.expected_sell_price)}</Td>
                    <Td right>{yen(o.net_profit)}</Td>
                    <Td right>{pct(Number(o.roi))}</Td>
                    <Td>
                      {o.passed ? (
                        <Badge tone="good">通知対象</Badge>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {(o.reasons as string[]).slice(0, 2).map((r) => (
                            <Badge key={r} tone="bad">
                              {r}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}

export default async function Page({ params }: PageProps<"/products/[asin]">) {
  const { asin } = await params;
  return (
    <SetupGuard>
      <Detail asin={asin} />
    </SetupGuard>
  );
}
