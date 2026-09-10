import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { days, pct, yen } from "@/lib/format";
import { stopLossView } from "@/lib/server/steps/risk";

export const dynamic = "force-dynamic";

async function StopLoss() {
  const { rows, inventory, breached } = await stopLossView();
  const t = inventory.settings.thresholds;
  const near = rows.filter((r) => !r.breached && r.toStopRate !== null && r.toStopRate < 0.05);

  return (
    <StepShell
      stepKey="risk"
      sub="stoploss"
      actions={
        <form action="/api/cron/exit-scan" method="post">
          <button className="btn btn-soft">いま判定する</button>
        </form>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="損切りラインを割った"
          value={`${breached}件`}
          sub="すぐに判断が要ります"
          tone={breached > 0 ? "bad" : "good"}
        />
        <Stat label="ラインまで5%以内" value={`${near.length}件`} tone={near.length ? "warn" : "default"} />
        <Stat label="損切りの基準" value={pct(t.stopLossRate, 0)} sub="取得原価に対して" />
        <Stat
          label="いま全部売った場合"
          value={yen(rows.reduce((a, r) => a + (r.profitIfSoldNow ?? 0), 0))}
          sub="手数料を引いた差額の合計"
          tone={rows.reduce((a, r) => a + (r.profitIfSoldNow ?? 0), 0) >= 0 ? "good" : "bad"}
        />
      </div>

      <div className="mt-4">
        <Callout tone={breached > 0 ? "bad" : "info"}>
          損切りラインは<span className="num"> 取得原価 × (1 {pct(t.stopLossRate, 0)}) </span>で、
          買った時点で決まります。ここを割ったら、戻るのを待たずに撤退するのが決めごとです。
          「いま売ったらいくらか」は手数料（販売手数料・配送代行・保管料・返品引当）を引いた額で出しています。
        </Callout>
      </div>

      <Card className="mt-4" title="損切りラインまでの距離（近い順）">
        {rows.length === 0 ? (
          <Empty>保有中の在庫がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[1000px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>取得原価</Th>
                  <Th right>いまの価格</Th>
                  <Th right>損切りライン</Th>
                  <Th right>ラインまで</Th>
                  <Th right>含み損益</Th>
                  <Th right>いま売ったら</Th>
                  <Th right>保有</Th>
                  <Th>状態</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.position.id}>
                    <Td>
                      <Link
                        href={`/positions/${r.position.id}`}
                        className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                      >
                        {r.position.products?.title ?? r.position.asin}
                      </Link>
                      <span className="num text-[11px] text-[var(--muted)]">{r.position.qty}個</span>
                    </Td>
                    <Td right className="text-xs">{yen(r.position.acquisition_cost)}</Td>
                    <Td right className="font-semibold">
                      {r.current === null ? <span className="text-xs text-[var(--muted)]">未取得</span> : yen(r.current)}
                    </Td>
                    <Td right className="text-xs text-[var(--bad)]">{yen(r.position.stop_price)}</Td>
                    <Td right>
                      {r.toStopRate === null ? (
                        "—"
                      ) : (
                        <span
                          className={
                            r.breached
                              ? "num font-bold text-[var(--bad)]"
                              : r.toStopRate < 0.05
                                ? "num text-[var(--warn)]"
                                : "num text-[var(--muted)]"
                          }
                        >
                          {pct(r.toStopRate, 1)}
                        </span>
                      )}
                    </Td>
                    <Td right>{r.unrealized === null ? "—" : <Money value={r.unrealized} signed />}</Td>
                    <Td right>
                      {r.profitIfSoldNow === null ? "—" : <Money value={r.profitIfSoldNow} signed />}
                    </Td>
                    <Td right className="text-xs">{days(r.heldDays)}</Td>
                    <Td>
                      {r.breached ? (
                        <Badge tone="bad">割っています</Badge>
                      ) : r.live.some((s) => s.kind === "stop_loss") ? (
                        <Badge tone="warn">{r.live.find((s) => s.kind === "stop_loss")?.rule}</Badge>
                      ) : (
                        <Badge tone="good">問題なし</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="発生している損切りシグナル">
        {rows.every((r) => r.live.every((s) => s.kind !== "stop_loss")) ? (
          <Empty>ありません</Empty>
        ) : (
          <ul className="space-y-2">
            {rows.flatMap((r) =>
              r.live
                .filter((s) => s.kind === "stop_loss")
                .map((s) => (
                  <li
                    key={`${r.position.id}-${s.rule}`}
                    className="rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-soft)] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="bad">{s.rule}</Badge>
                      <Link
                        href={`/positions/${r.position.id}`}
                        className="text-sm font-semibold hover:underline"
                      >
                        {r.position.products?.title ?? r.position.asin}
                      </Link>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">{s.message}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">提案：{r.plan.reason}</p>
                  </li>
                )),
            )}
          </ul>
        )}
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <StopLoss />
    </SetupGuard>
  );
}
