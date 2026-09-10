import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat } from "@/components/ui";
import { dateTime, days, pct, yen } from "@/lib/format";
import { inventoryView } from "@/lib/server/steps/inventory";

export const dynamic = "force-dynamic";

const FAILURE_CODES = [
  ["", "（損失なし）"],
  ["price_drop", "相場が下がった"],
  ["competition", "競合が増えた"],
  ["slow_sales", "売れ行きが遅かった"],
  ["fee_miss", "手数料の見積り違い"],
  ["demand_gone", "需要が消えた"],
  ["other", "その他"],
] as const;

async function Alerts() {
  const view = await inventoryView();
  const reached = view.rows.filter((r) => r.live.some((s) => s.kind === "take_profit"));
  const others = view.rows.filter((r) => !r.live.some((s) => s.kind === "take_profit"));

  return (
    <StepShell
      stepKey="inventory"
      sub="alerts"
      actions={
        <form action="/api/cron/exit-scan" method="post">
          <button className="btn btn-soft">いま判定する</button>
        </form>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="売り時が来ている"
          value={`${reached.length}件`}
          tone={reached.length > 0 ? "good" : "default"}
        />
        <Stat label="保有中" value={`${view.totals.positions}件`} sub={`${view.totals.units}個`} />
        <Stat
          label="含み益の合計"
          value={yen(view.rows.reduce((a, r) => a + Math.max(0, r.unrealized ?? 0), 0))}
          tone="good"
        />
        <Stat
          label="損切りシグナル"
          value={`${view.totals.stopLoss}件`}
          sub="⑦で扱います"
          tone={view.totals.stopLoss > 0 ? "bad" : "default"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          利確の合図は4つです。
          <span className="num"> E-1</span> 値引きが終わって相場が戻った、
          <span className="num"> E-2</span> 目標価格に届いた、
          <span className="num"> E-3</span> 最高値から {pct(view.settings.thresholds.trailingDrop, 0)} 下がった、
          <span className="num"> E-4</span> 売れ行きが急に良くなった。
          売れたら下の欄に価格を入れて記録してください。手数料を引いた確定利益が⑧に反映されます。
        </Callout>
      </div>

      <div className="mt-4 space-y-4">
        {reached.length === 0 ? (
          <Empty>いま売り時の在庫はありません</Empty>
        ) : (
          reached.map((r) => (
            <Card
              key={r.position.id}
              title={r.position.products?.title ?? r.position.asin}
              action={
                <Link href={`/positions/${r.position.id}`} className="text-xs text-[var(--accent)]">
                  詳細
                </Link>
              }
            >
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <ul className="space-y-2">
                    {r.live
                      .filter((s) => s.kind === "take_profit")
                      .map((s) => (
                        <li key={s.rule} className="rounded-lg border border-[var(--good)]/30 bg-[var(--good-soft)] p-2.5">
                          <Badge tone="good">{s.rule} 利確</Badge>
                          <p className="mt-1 text-xs text-[var(--ink-soft)]">{s.message}</p>
                        </li>
                      ))}
                  </ul>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-[var(--muted)]">いまの価格</dt>
                      <dd className="num font-bold">{r.current === null ? "—" : yen(r.current)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">目標価格</dt>
                      <dd className="num font-bold">{yen(r.position.target_price)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">含み損益</dt>
                      <dd className="font-bold">
                        {r.unrealized === null ? "—" : <Money value={r.unrealized} signed />}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">保有</dt>
                      <dd className="num font-bold">{days(r.heldDays)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--ink-soft)]">
                    提案：{r.plan.reason}
                  </p>
                </div>

                <form action={`/api/positions/${r.position.id}/sell`} method="post" className="space-y-2">
                  <h3 className="text-xs font-bold text-[var(--ink-soft)]">売れたら記録する</h3>
                  <label className="block text-xs text-[var(--muted)]">
                    売却価格（1個）
                    <input
                      name="sellPrice"
                      type="number"
                      required
                      defaultValue={r.plan.price}
                      className="field num mt-1"
                    />
                  </label>
                  <label className="block text-xs text-[var(--muted)]">
                    数量
                    <input
                      name="qty"
                      type="number"
                      min={1}
                      max={r.position.qty}
                      defaultValue={r.plan.qty}
                      className="field num mt-1"
                    />
                  </label>
                  <label className="block text-xs text-[var(--muted)]">
                    きっかけ
                    <input
                      name="exitRule"
                      defaultValue={r.live[0]?.rule ?? ""}
                      className="field mt-1"
                      placeholder="E-2 など"
                    />
                  </label>
                  <label className="block text-xs text-[var(--muted)]">
                    損になった原因
                    <select name="failureReasonCode" className="field mt-1" defaultValue="">
                      {FAILURE_CODES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn-primary w-full">売却を記録する</button>
                </form>
              </div>
            </Card>
          ))
        )}
      </div>

      <Card className="mt-4" title="まだ売り時ではない在庫">
        {others.length === 0 ? (
          <Empty>ありません</Empty>
        ) : (
          <ul className="space-y-2">
            {others.map((r) => (
              <li
                key={r.position.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2"
              >
                <Link
                  href={`/positions/${r.position.id}`}
                  className="line-clamp-1 text-sm hover:text-[var(--accent)]"
                >
                  {r.position.products?.title ?? r.position.asin}
                </Link>
                <span className="num shrink-0 text-xs text-[var(--muted)]">
                  いま {r.current === null ? "—" : yen(r.current)} / 目標 {yen(r.position.target_price)} / 保有{" "}
                  {days(r.heldDays)}
                  {r.observedAt ? ` / 観測 ${dateTime(r.observedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Alerts />
    </SetupGuard>
  );
}
