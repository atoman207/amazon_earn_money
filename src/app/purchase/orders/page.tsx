import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { dateTime, yen } from "@/lib/format";
import { orderHistory } from "@/lib/server/steps/purchase";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "good" | "bad" | "default" }> = {
  placed: { label: "発注済み", tone: "good" },
  failed: { label: "失敗", tone: "bad" },
  cancelled: { label: "取消", tone: "default" },
};

const MODE: Record<string, string> = {
  A: "手動",
  B: "承認購入",
  C: "全自動",
};

async function Orders() {
  const { orders, positionsByOrder, totals } = await orderHistory();

  return (
    <StepShell stepKey="purchase" sub="orders">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="購入の記録" value={`${totals.count}件`} sub={`${totals.units}個`} />
        <Stat label="支払った金額" value={yen(totals.amount)} sub="実支払額があればそちらを使います" />
        <Stat
          label="注文番号あり"
          value={`${totals.withEvidence}件`}
          sub="証憑が残っているもの"
          tone={totals.count > 0 && totals.withEvidence === totals.count ? "good" : "warn"}
        />
        <Stat
          label="在庫になった"
          value={`${orders.filter((o) => positionsByOrder.has(o.id)).length}件`}
          sub="⑥で追いかけています"
        />
      </div>

      <div className="mt-4">
        <Callout>
          購入は<span className="font-bold">お客様のAmazonアカウント</span>で行い、
          その記録をここに残します。注文番号と実支払額を入れておくと、
          ⑧の「見込みと実際のズレ」を正確に出せます（入れなくても動きますが、精度は落ちます）。
        </Callout>
      </div>

      <Card className="mt-4" title="購入履歴">
        {orders.length === 0 ? (
          <Empty>
            まだ購入の記録がありません。
            <Link href="/purchase/approve" className="ml-1 underline">
              承認
            </Link>
            すると、ここに残ります。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[980px]">
              <thead>
                <tr>
                  <Th>日時</Th>
                  <Th>商品</Th>
                  <Th right>数量</Th>
                  <Th right>単価</Th>
                  <Th right>取得原価</Th>
                  <Th right>実支払額</Th>
                  <Th>注文番号</Th>
                  <Th>モード</Th>
                  <Th>状態</Th>
                  <Th>在庫</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const s = STATUS[o.status] ?? { label: o.status, tone: "default" as const };
                  const position = positionsByOrder.get(o.id);
                  return (
                    <tr key={o.id}>
                      <Td className="text-xs text-[var(--muted)]">{dateTime(o.ordered_at)}</Td>
                      <Td>
                        <Link href={`/products/${o.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {o.products?.title ?? o.asin}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{o.asin}</span>
                      </Td>
                      <Td right>{o.qty}</Td>
                      <Td right className="text-xs">{yen(o.unit_price)}</Td>
                      <Td right className="text-xs">{yen(o.acquisition_cost)}</Td>
                      <Td right className="text-xs">
                        {o.actual_paid == null ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          yen(o.actual_paid)
                        )}
                      </Td>
                      <Td className="num text-[11px] text-[var(--muted)]">{o.amazon_order_id ?? "—"}</Td>
                      <Td className="text-xs">{MODE[o.mode] ?? o.mode}</Td>
                      <Td>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </Td>
                      <Td>
                        {position ? (
                          <Link
                            href={`/positions/${position.id}`}
                            className="text-xs text-[var(--accent)] hover:underline"
                          >
                            {position.status === "sold"
                              ? "売却済み"
                              : position.status === "stopped"
                                ? "損切り済み"
                                : "保有中"}
                          </Link>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
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
      <Orders />
    </SetupGuard>
  );
}
