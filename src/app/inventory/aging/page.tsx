import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Bar, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateOnly, days, yen } from "@/lib/format";
import { inventoryView } from "@/lib/server/steps/inventory";

export const dynamic = "force-dynamic";

async function Aging() {
  const view = await inventoryView();
  const t = view.settings.thresholds;

  const buckets = [
    { label: "7日以内", test: (d: number) => d <= 7, tone: "good" as const },
    { label: "8〜30日", test: (d: number) => d > 7 && d <= 30, tone: "good" as const },
    {
      label: `31〜${t.timeStopDays}日`,
      test: (d: number) => d > 30 && d < t.timeStopDays,
      tone: "warn" as const,
    },
    {
      label: `${t.timeStopDays}〜${t.forceSellDays}日`,
      test: (d: number) => d >= t.timeStopDays && d < t.forceSellDays,
      tone: "warn" as const,
    },
    { label: `${t.forceSellDays}日以上`, test: (d: number) => d >= t.forceSellDays, tone: "bad" as const },
  ].map((b) => {
    const rows = view.rows.filter((r) => b.test(r.heldDays));
    return {
      ...b,
      count: rows.length,
      units: rows.reduce((a, r) => a + r.position.qty, 0),
      capital: rows.reduce((a, r) => a + r.position.qty * Number(r.position.acquisition_cost), 0),
    };
  });

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const totalStorage = view.rows.reduce((a, r) => a + r.storageAccrued, 0);

  return (
    <StepShell stepKey="inventory" sub="aging">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="平均の保有日数"
          value={days(view.rows.length ? view.rows.reduce((a, r) => a + r.heldDays, 0) / view.rows.length : null)}
          sub={`${view.rows.length}件の在庫`}
        />
        <Stat
          label={`${t.timeStopDays}日を超えた在庫`}
          value={`${view.totals.aging}件`}
          sub="値下げを始める目安"
          tone={view.totals.aging > 0 ? "warn" : "good"}
        />
        <Stat
          label="発生した保管料"
          value={yen(totalStorage)}
          sub={`1日 ${yen(view.settings.costs.storageFeePerDay)}／個で計算`}
          tone={totalStorage > 0 ? "warn" : "default"}
        />
        <Stat
          label="いちばん長い在庫"
          value={days(view.rows.length ? Math.max(...view.rows.map((r) => r.heldDays)) : null)}
        />
      </div>

      <div className="mt-4">
        <Callout>
          在庫は持っているだけで保管料がかかり、利益を削ります。
          {t.timeStopDays}日を超えたら値下げを始め、{t.forceSellDays}日を超えたら成行で現金化する、
          という基準で運用します。日数の判断は⑦の
          <Link href="/risk/longterm" className="mx-1 underline">
            長期在庫の売却判断
          </Link>
          で行います。
        </Callout>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="保有日数の分布">
          <ul className="space-y-3">
            {buckets.map((b) => (
              <li key={b.label}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{b.label}</span>
                  <span className="num text-xs text-[var(--muted)]">
                    {b.count}件 / {yen(b.capital)}
                  </span>
                </div>
                <Bar
                  value={b.count}
                  max={maxCount}
                  color={b.tone === "good" ? "var(--good)" : b.tone === "warn" ? "var(--warn)" : "var(--bad)"}
                />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="在庫日数（長い順）" className="lg:col-span-2">
          {view.rows.length === 0 ? (
            <Empty>保有中の在庫がありません</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[760px]">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th>取得日</Th>
                    <Th right>保有</Th>
                    <Th right>拘束資金</Th>
                    <Th right>発生保管料</Th>
                    <Th right>含み損益</Th>
                    <Th>状態</Th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows
                    .slice()
                    .sort((a, b) => b.heldDays - a.heldDays)
                    .map((r) => (
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
                        <Td className="text-xs text-[var(--muted)]">{dateOnly(r.position.opened_at)}</Td>
                        <Td right className="font-semibold">{days(r.heldDays)}</Td>
                        <Td right className="text-xs">
                          {yen(r.position.qty * Number(r.position.acquisition_cost))}
                        </Td>
                        <Td right className="text-xs text-[var(--warn)]">{yen(r.storageAccrued)}</Td>
                        <Td right>
                          {r.unrealized === null ? "—" : <Money value={r.unrealized} signed />}
                        </Td>
                        <Td>
                          {r.heldDays >= t.forceSellDays ? (
                            <Badge tone="bad">成行の期限</Badge>
                          ) : r.heldDays >= t.timeStopDays ? (
                            <Badge tone="warn">値下げ開始</Badge>
                          ) : (
                            <Badge tone="good">通常</Badge>
                          )}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Aging />
    </SetupGuard>
  );
}
