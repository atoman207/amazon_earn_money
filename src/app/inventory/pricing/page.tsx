import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { days, yen } from "@/lib/format";
import { inventoryView } from "@/lib/server/steps/inventory";

export const dynamic = "force-dynamic";

const URGENCY: Record<string, { label: string; tone: "bad" | "warn" | "default" }> = {
  now: { label: "いま出す", tone: "bad" },
  soon: { label: "早めに出す", tone: "warn" },
  hold: { label: "待つ", tone: "default" },
};

async function Pricing() {
  const view = await inventoryView();
  const now = view.rows.filter((r) => r.plan.urgency === "now");
  const soon = view.rows.filter((r) => r.plan.urgency === "soon");

  return (
    <StepShell stepKey="inventory" sub="pricing">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="いま出すべき" value={`${now.length}件`} tone={now.length ? "bad" : "default"} />
        <Stat label="早めに出す" value={`${soon.length}件`} tone={soon.length ? "warn" : "default"} />
        <Stat label="待つ" value={`${view.rows.length - now.length - soon.length}件`} />
        <Stat
          label="提案どおり出した場合"
          value={yen(view.rows.reduce((a, r) => a + r.plan.price * r.plan.qty, 0))}
          sub="売上の見込み（手数料は引く前）"
        />
      </div>

      <div className="mt-4">
        <Callout>
          価格の提案は出口の理由から決めます。
          損切りなら<span className="font-bold">売れる価格</span>（現在価格）で全数、
          利確なら<span className="font-bold">高く売れる価格</span>（目標価格）でまず半分、
          時間切れなら段階値下げ後の価格で全数、動く理由が無ければ目標価格のまま待ちます。
          決めるのは提案までで、実際に出すかどうかは人が決めます。
        </Callout>
      </div>

      <Card className="mt-4" title="売却価格と数量の提案">
        {view.rows.length === 0 ? (
          <Empty>保有中の在庫がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[1000px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th>急ぎ</Th>
                  <Th right>いまの価格</Th>
                  <Th right>提案価格</Th>
                  <Th right>提案数量</Th>
                  <Th right>1個あたりの差</Th>
                  <Th right>保有</Th>
                  <Th>理由</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows
                  .slice()
                  .sort((a, b) => {
                    const rank = { now: 0, soon: 1, hold: 2 } as const;
                    return rank[a.plan.urgency] - rank[b.plan.urgency];
                  })
                  .map((r) => {
                    const u = URGENCY[r.plan.urgency];
                    return (
                      <tr key={r.position.id}>
                        <Td>
                          <Link
                            href={`/positions/${r.position.id}`}
                            className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                          >
                            {r.position.products?.title ?? r.position.asin}
                          </Link>
                          <span className="num text-[11px] text-[var(--muted)]">
                            原価 {yen(r.position.acquisition_cost)} / {r.position.qty}個
                          </span>
                        </Td>
                        <Td>
                          <Badge tone={u.tone}>{u.label}</Badge>
                        </Td>
                        <Td right className="text-xs">{r.current === null ? "—" : yen(r.current)}</Td>
                        <Td right className="font-semibold">{yen(r.plan.price)}</Td>
                        <Td right>
                          {r.plan.qty}
                          <span className="text-[11px] text-[var(--muted)]">/{r.position.qty}個</span>
                        </Td>
                        <Td right>
                          <Money value={r.plan.spreadPerUnit} signed />
                        </Td>
                        <Td right className="text-xs">{days(r.heldDays)}</Td>
                        <Td className="text-xs text-[var(--muted)]">
                          {r.plan.reason}
                          {r.plan.stepping && (
                            <span className="ml-1 text-[var(--warn)]">（段階値下げ中）</span>
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

      <Card className="mt-4" title="提案どおりに出すには">
        <ol className="space-y-1.5 text-xs text-[var(--muted)]">
          <li>1. Amazonセラーセントラルで、その商品の出品価格を提案価格に変更します。</li>
          <li>2. 売れたら「目標価格に達したら販売通知」の画面で売却を記録します。</li>
          <li>3. 記録した内容が⑧の集計と、次回の判断の材料になります。</li>
        </ol>
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Pricing />
    </SetupGuard>
  );
}
