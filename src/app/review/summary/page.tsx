import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateOnly, days, pct, yen } from "@/lib/format";
import { summaryView } from "@/lib/server/steps/review";

export const dynamic = "force-dynamic";

async function Summary() {
  const view = await summaryView();
  const t = view.totals;
  const monthProfit = view.thisMonthProfit;

  return (
    <StepShell stepKey="review" sub="summary">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="確定利益（累計）"
          value={yen(t.realized)}
          sub={`売上 ${yen(t.revenue)} / 手数料 ${yen(t.fees)}`}
          tone={t.realized > 0 ? "good" : t.realized < 0 ? "bad" : "default"}
        />
        <Stat
          label="勝率"
          value={t.winRate === null ? "—" : pct(t.winRate, 0)}
          sub={`${t.count}件・${t.units}個の売却`}
          tone={t.winRate !== null && t.winRate >= 0.6 ? "good" : "default"}
        />
        <Stat
          label="平均ROI"
          value={t.avgRoi === null ? "—" : pct(t.avgRoi)}
          sub={`平均保有 ${days(t.avgHoldingDays)}`}
        />
        <Stat
          label="総利益 / 総損失"
          value={t.profitFactor === null ? (t.grossProfit > 0 ? "∞" : "—") : t.profitFactor.toFixed(2)}
          sub={`勝ち ${yen(t.grossProfit)} / 負け ${yen(t.grossLoss)}`}
          tone={t.profitFactor !== null && t.profitFactor >= 1 ? "good" : "bad"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="月別" className="lg:col-span-2">
          {view.byMonth.length === 0 ? (
            <Empty>売却の記録がありません</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[520px]">
                <thead>
                  <tr>
                    <Th>月</Th>
                    <Th right>売上</Th>
                    <Th right>確定利益</Th>
                    <Th right>利益率</Th>
                    <Th right>件数</Th>
                    <Th right>個数</Th>
                  </tr>
                </thead>
                <tbody>
                  {view.byMonth.map((m) => (
                    <tr key={m.month}>
                      <Td className="num">{m.month.replace("-", "年")}月</Td>
                      <Td right className="text-xs">{yen(m.revenue)}</Td>
                      <Td right>
                        <Money value={m.profit} />
                      </Td>
                      <Td right className="text-xs">{m.revenue ? pct(m.profit / m.revenue) : "—"}</Td>
                      <Td right className="text-xs">{m.count}</Td>
                      <Td right className="text-xs">{m.units}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="いま止まっている資金">
            <dl className="divide-y divide-[var(--line)]/60 text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-[var(--muted)]">保有中の在庫</dt>
                <dd className="num">{view.openPositions.count}件</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-[var(--muted)]">個数</dt>
                <dd className="num">{view.openPositions.units}個</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-[var(--muted)]">拘束している資金</dt>
                <dd className="num">{yen(view.openPositions.deployed)}</dd>
              </div>
            </dl>
            <Link href="/inventory/monitor" className="btn mt-3 w-full">
              在庫を見る
            </Link>
          </Card>

          <Card title="今月">
            <div className="text-xs text-[var(--muted)]">確定利益</div>
            <div className="num mt-1 text-2xl font-bold">
              <Money value={monthProfit} />
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              確定利益は、売却価格から販売手数料・配送代行手数料・保管料・返品引当を引き、
              取得原価を差し引いた残りです。
            </p>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="カテゴリ別">
          {view.byCategory.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <table className="row-hover w-full">
              <thead>
                <tr>
                  <Th>カテゴリ</Th>
                  <Th right>確定利益</Th>
                  <Th right>利益率</Th>
                  <Th right>個数</Th>
                </tr>
              </thead>
              <tbody>
                {view.byCategory.map((c) => (
                  <tr key={c.category}>
                    <Td className="text-sm">{c.category}</Td>
                    <Td right>
                      <Money value={c.profit} />
                    </Td>
                    <Td right className="text-xs">{c.revenue ? pct(c.profit / c.revenue) : "—"}</Td>
                    <Td right className="text-xs">{c.units}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="出口ルール別">
          {view.byRule.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {view.byRule.map((r) => (
                <li key={r.rule} className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">
                    {r.rule} <span className="text-xs">（{r.count}件）</span>
                  </span>
                  <Money value={r.profit} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
            どの判定が効いているかが分かります。E は利確、X は損切りの合図です。
          </p>
        </Card>
      </div>

      <Card className="mt-4" title="売却履歴">
        {view.sales.length === 0 ? (
          <Empty>
            まだ売却の記録がありません。⑥で売却を記録すると、ここに1件ずつ積み上がります。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[860px]">
              <thead>
                <tr>
                  <Th>売却日</Th>
                  <Th>商品</Th>
                  <Th right>数量</Th>
                  <Th right>売却価格</Th>
                  <Th right>手数料</Th>
                  <Th right>確定利益</Th>
                  <Th right>保有</Th>
                  <Th>きっかけ</Th>
                </tr>
              </thead>
              <tbody>
                {view.sales.slice(0, 60).map((s) => (
                  <tr key={s.id}>
                    <Td className="text-xs text-[var(--muted)]">{dateOnly(s.sold_at)}</Td>
                    <Td>
                      <Link href={`/products/${s.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                        {s.products?.title ?? s.asin}
                      </Link>
                    </Td>
                    <Td right>{s.qty}</Td>
                    <Td right className="text-xs">{yen(s.sell_price)}</Td>
                    <Td right className="text-xs text-[var(--bad)]">−{yen(s.fees)}</Td>
                    <Td right>
                      <Money value={Number(s.realized_profit)} />
                    </Td>
                    <Td right className="text-xs">{days(Number(s.holding_days))}</Td>
                    <Td className="text-xs text-[var(--muted)]">{s.exit_rule ?? "（手動）"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4">
        <Callout>
          この集計は⑥で記録した売却だけを見ています。手数料は売却時点の設定で計算しているため、
          設定を変えても過去の確定利益は変わりません（後から数字が動かないようにするためです）。
        </Callout>
      </div>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Summary />
    </SetupGuard>
  );
}
