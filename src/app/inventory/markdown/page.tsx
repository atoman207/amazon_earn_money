import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { days, pct, yen } from "@/lib/format";
import { inventoryView } from "@/lib/server/steps/inventory";

export const dynamic = "force-dynamic";

async function Markdown() {
  const view = await inventoryView();
  const t = view.settings.thresholds;
  const stepping = view.rows.filter((r) => r.plan.stepping);

  return (
    <StepShell stepKey="inventory" sub="markdown">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="値下げが始まっている"
          value={`${stepping.length}件`}
          sub={`${t.timeStopDays}日を超えたもの`}
          tone={stepping.length > 0 ? "warn" : "good"}
        />
        <Stat label="値下げを始める日数" value={`${t.timeStopDays}日`} />
        <Stat label="成行で売る日数" value={`${t.forceSellDays}日`} />
        <Stat label="下限価格の基準" value={pct(t.stopLossRate, 0)} sub="取得原価に対して" />
      </div>

      <div className="mt-4">
        <Callout>
          値下げは一気にではなく段階で進めます。{t.timeStopDays}日を過ぎたところから、
          {t.forceSellDays}日で下限（取得原価の {pct(t.stopLossRate, 0)}）に届くように、
          日数に応じてまっすぐ下げていきます。
          下限より下げないのは、それ以上は損切りの判断（⑦）に移すためです。
        </Callout>
      </div>

      {view.rows.length === 0 ? (
        <div className="mt-4">
          <Empty>保有中の在庫がありません</Empty>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {view.rows
            .slice()
            .sort((a, b) => b.heldDays - a.heldDays)
            .map((r) => {
              const floor = Math.max(
                1,
                Math.round(Number(r.position.acquisition_cost) * (1 + t.stopLossRate)),
              );
              return (
                <Card
                  key={r.position.id}
                  title={r.position.products?.title ?? r.position.asin}
                  action={
                    <span className="flex items-center gap-2">
                      <Badge tone={r.plan.stepping ? "warn" : "default"}>
                        {r.plan.stepping ? "値下げ中" : `あと ${days(Math.max(0, t.timeStopDays - r.heldDays))}で開始`}
                      </Badge>
                      <Link href={`/positions/${r.position.id}`} className="text-xs text-[var(--accent)]">
                        詳細
                      </Link>
                    </span>
                  }
                >
                  <div className="grid gap-4 lg:grid-cols-3">
                    <dl className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-[var(--muted)]">保有日数</dt>
                        <dd className="num font-semibold">{days(r.heldDays)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[var(--muted)]">取得原価</dt>
                        <dd className="num">{yen(r.position.acquisition_cost)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[var(--muted)]">いまの価格</dt>
                        <dd className="num">{r.current === null ? "—" : yen(r.current)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[var(--muted)]">下限価格</dt>
                        <dd className="num text-[var(--bad)]">{yen(floor)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[var(--muted)]">いま出すなら</dt>
                        <dd className="num font-semibold">{yen(r.plan.price)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[var(--muted)]">1個あたりの差</dt>
                        <dd>
                          <Money value={r.plan.spreadPerUnit} signed />
                        </dd>
                      </div>
                    </dl>

                    <div className="lg:col-span-2">
                      <h3 className="mb-2 text-xs font-bold text-[var(--ink-soft)]">値下げの予定</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[420px]">
                          <thead>
                            <tr>
                              <Th>いつ</Th>
                              <Th>段階</Th>
                              <Th right>出す価格</Th>
                              <Th right>1個あたりの差</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.markdown.map((m) => {
                              const passed = r.heldDays >= m.day;
                              return (
                                <tr key={m.day} className={passed ? "bg-[var(--surface-2)]" : ""}>
                                  <Td className="num text-xs">
                                    {m.day}日目
                                    {passed && <span className="ml-1 text-[10px] text-[var(--warn)]">通過</span>}
                                  </Td>
                                  <Td className="text-xs text-[var(--muted)]">{m.note}</Td>
                                  <Td right className="num text-xs font-semibold">{yen(m.price)}</Td>
                                  <Td right>
                                    <Money value={m.price - Number(r.position.acquisition_cost)} signed />
                                  </Td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-2 text-[11px] text-[var(--muted)]">
                        {r.plan.reason}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
        </div>
      )}
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Markdown />
    </SetupGuard>
  );
}
