import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateOnly, days, pct, yen } from "@/lib/format";
import { backtestView } from "@/lib/server/steps/judge";

export const dynamic = "force-dynamic";

const EXIT_LABEL: Record<string, { label: string; tone: "good" | "bad" | "warn" | "default" }> = {
  target: { label: "目標到達", tone: "good" },
  stop_loss: { label: "損切り", tone: "bad" },
  time_stop: { label: "時間切れ", tone: "warn" },
  open: { label: "未決", tone: "default" },
};

async function History() {
  const { summary, results, trades, params, windowDays } = await backtestView();
  const reliable = results.filter((r) => r.reliable).length;

  return (
    <StepShell stepKey="backtest" sub="history">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="勝率"
          value={summary.winRate === null ? "—" : pct(summary.winRate, 0)}
          sub={`${summary.totalTrades}件の取引`}
          tone={summary.winRate !== null && summary.winRate >= 0.6 ? "good" : "default"}
        />
        <Stat
          label="平均利益率"
          value={summary.avgRoi === null ? "—" : pct(summary.avgRoi)}
          tone={summary.avgRoi !== null && summary.avgRoi > 0 ? "good" : "bad"}
        />
        <Stat label="平均保有日数" value={days(summary.avgHoldingDays)} />
        <Stat
          label="最大損失"
          value={summary.maxLoss === null ? "—" : yen(summary.maxLoss)}
          tone={summary.maxLoss === null ? "default" : "bad"}
        />
        <Stat
          label="総利益 / 総損失"
          value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}
          sub={`累計 ${yen(summary.totalProfit)}`}
          tone={summary.profitFactor !== null && summary.profitFactor >= 1 ? "good" : "bad"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          過去{windowDays}日の実際の価格をなぞり、「この条件で買っていたらどうだったか」を再現しています。
          判定に使う中央値は<span className="font-bold">その時点より前の観測だけ</span>で作るので、
          未来を覗いた分だけ成績が良く見えることはありません。手数料は本番と同じ計算を通し、
          建玉は重ねず（1件を売り切ってから次を探す）、決着がつかなかった取引は勝率に混ぜていません。
        </Callout>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="検証に使った条件">
          <dl className="divide-y divide-[var(--line)]/60 text-sm">
            {[
              ["買う条件（基準価格からの下落）", pct(params.minDiscountRate, 0)],
              ["基準価格の窓", `${params.medianWindowDays}日`],
              ["利確（取得原価に対する利益率）", pct(params.targetProfitRate, 0)],
              ["損切り（取得原価比）", pct(params.stopLossRate, 0)],
              ["時間切れ", `${params.timeStopDays}日`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2">
                <dt className="text-[var(--muted)]">{label}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            利確・損切り・時間切れは、いまの
            <Link href="/settings" className="mx-1 underline">
              設定
            </Link>
            をそのまま使っています。設定を変えるとこの結果も変わります。
          </p>
        </Card>

        <Card title="銘柄ごとの成績" className="lg:col-span-2">
          {results.length === 0 ? (
            <Empty>監視している銘柄がありません</Empty>
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--muted)]">
                {results.length}銘柄のうち、勝率を語れるだけの取引があるのは {reliable}銘柄です
                （5件以上・180日以上）。
              </p>
              <div className="overflow-x-auto">
                <table className="row-hover w-full min-w-[620px]">
                  <thead>
                    <tr>
                      <Th>ASIN</Th>
                      <Th right>取引</Th>
                      <Th right>勝率</Th>
                      <Th right>平均ROI</Th>
                      <Th right>累計損益</Th>
                      <Th>信頼</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {results
                      .filter((r) => r.closed > 0)
                      .sort((a, b) => b.totalProfit - a.totalProfit)
                      .slice(0, 30)
                      .map((r) => (
                        <tr key={r.asin}>
                          <Td>
                            <Link href={`/products/${r.asin}`} className="num text-xs hover:text-[var(--accent)]">
                              {r.asin}
                            </Link>
                          </Td>
                          <Td right className="text-xs">{r.closed}件</Td>
                          <Td right className="text-xs">{r.winRate === null ? "—" : pct(r.winRate, 0)}</Td>
                          <Td right className="text-xs">{r.avgRoi === null ? "—" : pct(r.avgRoi)}</Td>
                          <Td right>
                            <Money value={r.totalProfit} />
                          </Td>
                          <Td>
                            <Badge tone={r.reliable ? "good" : "warn"}>
                              {r.reliable ? "十分" : "標本不足"}
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
      </div>

      <Card className="mt-4" title="再現された取引（新しい順）">
        {trades.length === 0 ? (
          <Empty>
            決着した取引がありません。価格の記録が {windowDays}日ぶん近くたまると、ここに1件ずつ出ます。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[820px]">
              <thead>
                <tr>
                  <Th>ASIN</Th>
                  <Th>買い</Th>
                  <Th right>仕入</Th>
                  <Th>売り</Th>
                  <Th right>売却</Th>
                  <Th right>保有</Th>
                  <Th right>損益</Th>
                  <Th right>ROI</Th>
                  <Th>終わり方</Th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const e = EXIT_LABEL[t.exitReason] ?? { label: t.exitReason, tone: "default" as const };
                  return (
                    <tr key={`${t.asin}-${t.entryAt}-${i}`}>
                      <Td className="num text-xs">{t.asin}</Td>
                      <Td className="text-xs text-[var(--muted)]">{dateOnly(t.entryAt)}</Td>
                      <Td right className="text-xs">{yen(t.buyPrice)}</Td>
                      <Td className="text-xs text-[var(--muted)]">{t.exitAt ? dateOnly(t.exitAt) : "—"}</Td>
                      <Td right className="text-xs">{t.exitPrice === null ? "—" : yen(t.exitPrice)}</Td>
                      <Td right className="text-xs">{days(t.holdingDays)}</Td>
                      <Td right>
                        <Money value={t.netProfit} />
                      </Td>
                      <Td right className="text-xs">{pct(t.roi)}</Td>
                      <Td>
                        <Badge tone={e.tone}>{e.label}</Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <History />
    </SetupGuard>
  );
}
