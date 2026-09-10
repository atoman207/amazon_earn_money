import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateOnly, days, pct, yen } from "@/lib/format";
import { longTermView } from "@/lib/server/steps/risk";

export const dynamic = "force-dynamic";

async function LongTerm() {
  const { rows, settings, thresholdDays, forceSellDays } = await longTermView();
  const forced = rows.filter((r) => r.heldDays >= forceSellDays);
  const totalCapital = rows.reduce(
    (a, r) => a + r.position.qty * Number(r.position.acquisition_cost),
    0,
  );

  return (
    <StepShell stepKey="risk" sub="longterm">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={`${thresholdDays}日を超えた在庫`}
          value={`${rows.length}件`}
          tone={rows.length > 0 ? "warn" : "good"}
        />
        <Stat
          label={`${forceSellDays}日を超えた在庫`}
          value={`${forced.length}件`}
          sub="成行で現金化する対象"
          tone={forced.length > 0 ? "bad" : "good"}
        />
        <Stat label="止まっている資金" value={yen(totalCapital)} sub="次の仕入れに使えていない額" />
        <Stat
          label="発生した保管料"
          value={yen(rows.reduce((a, r) => a + r.storageAccrued, 0))}
          tone={rows.length ? "warn" : "default"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          長く持つほど、保管料と「その資金で別のものを買えたはずの機会」の両方を失います。
          {thresholdDays}日を過ぎたら値下げを始め、{forceSellDays}日を過ぎたら相場で現金化します。
          保管料が想定利益の {pct(settings.thresholds.storageRatioCap, 0)} を超えたものは、
          待っても取り返せません。
        </Callout>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4">
          <Empty>{thresholdDays}日を超えている在庫はありません。</Empty>
        </div>
      ) : (
        <>
          <Card className="mt-4" title="長期在庫の一覧">
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[1020px]">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th>取得日</Th>
                    <Th right>保有</Th>
                    <Th right>超過</Th>
                    <Th right>成行まで</Th>
                    <Th right>拘束資金</Th>
                    <Th right>保管料</Th>
                    <Th right>保管料 / 想定利益</Th>
                    <Th right>いま売ったら</Th>
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
                      <Td className="text-xs text-[var(--muted)]">{dateOnly(r.position.opened_at)}</Td>
                      <Td right className="font-semibold">{days(r.heldDays)}</Td>
                      <Td right className="text-xs text-[var(--warn)]">+{days(r.overDays)}</Td>
                      <Td right className="text-xs">
                        {r.heldDays >= forceSellDays ? (
                          <Badge tone="bad">期限切れ</Badge>
                        ) : (
                          days(r.toForceSell)
                        )}
                      </Td>
                      <Td right className="text-xs">
                        {yen(r.position.qty * Number(r.position.acquisition_cost))}
                      </Td>
                      <Td right className="text-xs text-[var(--warn)]">{yen(r.storageAccrued)}</Td>
                      <Td right className="text-xs">
                        {r.storageRatio === null ? (
                          "—"
                        ) : (
                          <span
                            className={
                              r.storageRatio > settings.thresholds.storageRatioCap ? "text-[var(--bad)]" : ""
                            }
                          >
                            {pct(r.storageRatio, 0)}
                          </span>
                        )}
                      </Td>
                      <Td right>
                        {r.profitIfSoldNow === null ? "—" : <Money value={r.profitIfSoldNow} signed />}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 space-y-3">
            {rows.map((r) => (
              <Card
                key={`plan-${r.position.id}`}
                title={r.position.products?.title ?? r.position.asin}
                action={
                  <Badge tone={r.heldDays >= forceSellDays ? "bad" : "warn"}>
                    {days(r.heldDays)}保有
                  </Badge>
                }
              >
                <p className="text-sm text-[var(--ink-soft)]">{r.recommendation}</p>
                <p className="mt-1.5 text-xs text-[var(--muted)]">
                  提案：{r.plan.reason}（{yen(r.plan.price)} × {r.plan.qty}個）
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/positions/${r.position.id}`} className="btn">
                    売却を記録する
                  </Link>
                  <Link href="/inventory/markdown" className="btn">
                    値下げの予定を見る
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <LongTerm />
    </SetupGuard>
  );
}
