import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Bar, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateOnly, days, pct, yen } from "@/lib/format";
import { factorsView } from "@/lib/server/steps/review";

export const dynamic = "force-dynamic";

async function Factors() {
  const view = await factorsView();
  const maxFailure = Math.max(1, ...view.failures.map((f) => f.count));

  const table = (
    title: string,
    rows: typeof view.byCategory,
    firstHeader: string,
  ) => (
    <Card title={title}>
      {rows.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="row-hover w-full min-w-[420px]">
            <thead>
              <tr>
                <Th>{firstHeader}</Th>
                <Th right>件数</Th>
                <Th right>勝率</Th>
                <Th right>平均保有</Th>
                <Th right>損益</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key}>
                  <Td className="text-sm">{g.key}</Td>
                  <Td right className="text-xs">{g.count}</Td>
                  <Td right className="text-xs">{pct(g.winRate, 0)}</Td>
                  <Td right className="text-xs">{days(g.avgHoldingDays)}</Td>
                  <Td right>
                    <Money value={g.profit} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <StepShell stepKey="review" sub="factors">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="原因が記録された損失"
          value={`${view.failures.reduce((a, f) => a + f.count, 0)}件`}
          tone={view.failures.length ? "warn" : "default"}
        />
        <Stat
          label="原因が未記入の損失"
          value={`${view.unlabeledLosses}件`}
          sub="記録すると次の改善に使えます"
          tone={view.unlabeledLosses > 0 ? "warn" : "good"}
        />
        <Stat
          label="いちばん稼いだカテゴリ"
          value={view.byCategory[0]?.key ?? "—"}
          sub={view.byCategory[0] ? yen(view.byCategory[0].profit) : undefined}
        />
        <Stat
          label="いちばん負けたカテゴリ"
          value={[...view.byCategory].reverse()[0]?.key ?? "—"}
          sub={
            [...view.byCategory].reverse()[0]
              ? yen([...view.byCategory].reverse()[0].profit)
              : undefined
          }
        />
      </div>

      {view.notes.length > 0 && (
        <div className="mt-4 space-y-2">
          {view.notes.map((n) => (
            <Callout key={n} tone="info">
              {n}
            </Callout>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="損の原因">
          {view.failures.length === 0 ? (
            <Empty>
              まだ記録がありません。売却を記録するときに「損になった原因」を選ぶと、ここに集まります。
            </Empty>
          ) : (
            <ul className="space-y-3">
              {view.failures.map((f) => (
                <li key={f.code}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{f.label}</span>
                    <span className="num text-xs text-[var(--muted)]">
                      {f.count}件 / {yen(f.loss)}
                    </span>
                  </div>
                  <Bar value={f.count} max={maxFailure} color="var(--bad)" />
                </li>
              ))}
            </ul>
          )}
          {view.unlabeledLosses > 0 && (
            <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
              原因が未記入の損失が {view.unlabeledLosses}件あります。原因が無いと、
              ⑧-3の改善提案がその分だけ弱くなります。
            </p>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {table("カテゴリ別", view.byCategory, "カテゴリ")}
          {table("保有日数別", view.byHolding, "保有日数")}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="うまくいった5件">
          {view.best.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul className="space-y-2">
              {view.best.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[var(--good)]/30 bg-[var(--good-soft)] px-3 py-2"
                >
                  <Link href={`/products/${s.asin}`} className="line-clamp-1 text-sm hover:underline">
                    {s.products?.title ?? s.asin}
                  </Link>
                  <span className="num shrink-0 text-xs">
                    <Money value={Number(s.realized_profit)} /> / {days(Number(s.holding_days))} /{" "}
                    {dateOnly(s.sold_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="うまくいかなかった5件">
          {view.worst.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul className="space-y-2">
              {view.worst.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-soft)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/products/${s.asin}`} className="line-clamp-1 text-sm hover:underline">
                      {s.products?.title ?? s.asin}
                    </Link>
                    <span className="num shrink-0 text-xs">
                      <Money value={Number(s.realized_profit)} /> / {days(Number(s.holding_days))}
                    </span>
                  </div>
                  {s.note && <p className="mt-1 text-[11px] text-[var(--muted)]">{s.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Factors />
    </SetupGuard>
  );
}
