import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { days, pct, stars, yen } from "@/lib/format";
import { buyRules } from "@/lib/server/steps/judge";

export const dynamic = "force-dynamic";

async function Rules() {
  const { rules, settings } = await buyRules();
  const buyable = rules.filter((r) => r.buyable);
  const t = settings.thresholds;

  return (
    <StepShell stepKey="backtest" sub="rules">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="いま買える条件を満たす"
          value={`${buyable.length}件`}
          sub={`判定した ${rules.length}件のうち`}
          tone={buyable.length > 0 ? "good" : "default"}
        />
        <Stat
          label="仕入上限の合計"
          value={yen(buyable.reduce((a, r) => a + r.maxBuyPrice * r.suggestedQty, 0))}
          sub="この金額までなら条件を満たします"
        />
        <Stat
          label="期待利益の合計"
          value={yen(buyable.reduce((a, r) => a + r.expectedProfit * r.suggestedQty, 0))}
          sub="損切りの可能性を織り込んだ額"
        />
        <Stat label="推奨数量の合計" value={`${buyable.reduce((a, r) => a + r.suggestedQty, 0)}個`} />
      </div>

      <div className="mt-4">
        <Callout>
          <span className="font-bold">仕入上限価格</span>は「最低純利益と最低利益率の両方を満たす最大の仕入額」です
          （{yen(t.minNetProfit)}以上 かつ ROI {pct(t.minRoi, 0)}以上）。
          この値を超えて買うと、条件を満たさなくなります。
          <span className="font-bold">目標販売価格</span>は基準価格（相場）、
          <span className="font-bold">損切りライン</span>は取得原価の {pct(t.stopLossRate, 0)} です。
          数量は資金配分の上限（1銘柄 {pct(settings.capital.maxPerItemRatio, 0)}・
          1カテゴリ {pct(settings.capital.maxPerCategoryRatio, 0)}・現金留保 {pct(settings.capital.cashReserveRatio, 0)}）
          に収まる範囲で決めます。
        </Callout>
      </div>

      <Card className="mt-4" title="購入条件（判定つき）">
        {rules.length === 0 ? (
          <Empty>判定できる商品がありません。①のデータ収集と②の分析を先に動かしてください。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[1020px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>いまの仕入価格</Th>
                  <Th right>仕入上限</Th>
                  <Th right>推奨数量</Th>
                  <Th right>目標販売価格</Th>
                  <Th right>損切りライン</Th>
                  <Th right>期待利益</Th>
                  <Th right>ROI</Th>
                  <Th right>売れるまで</Th>
                  <Th right>信頼度</Th>
                  <Th>判定</Th>
                </tr>
              </thead>
              <tbody>
                {rules.slice(0, 60).map((r) => {
                  const e = r.row.evaluation!;
                  const overCap = r.row.buyPrice !== null && r.row.buyPrice > r.maxBuyPrice;
                  return (
                    <tr key={r.row.asin}>
                      <Td>
                        <Link href={`/products/${r.row.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {r.row.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{r.row.asin}</span>
                      </Td>
                      <Td right className={`text-xs ${overCap ? "text-[var(--bad)]" : ""}`}>
                        {yen(r.row.buyPrice)}
                      </Td>
                      <Td right className="font-semibold">{yen(r.maxBuyPrice)}</Td>
                      <Td right>{r.suggestedQty}個</Td>
                      <Td right className="text-xs">{yen(r.targetPrice)}</Td>
                      <Td right className="text-xs text-[var(--bad)]">{yen(r.stopPrice)}</Td>
                      <Td right>
                        <Money value={r.expectedProfit} />
                      </Td>
                      <Td right className="text-xs">{pct(r.roi)}</Td>
                      <Td right className="text-xs">{days(e.expectedDays)}</Td>
                      <Td right className="text-xs text-[var(--warn)]">{stars(e.confidence)}</Td>
                      <Td>
                        {r.buyable ? (
                          <Badge tone="good">買える</Badge>
                        ) : (
                          <span className="flex flex-col gap-0.5">
                            {r.reasons.slice(0, 2).map((reason) => (
                              <Badge key={reason} tone="bad">
                                {reason}
                              </Badge>
                            ))}
                          </span>
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

      <Card className="mt-4" title="この判定が次に何になるか">
        <ul className="space-y-1.5 text-xs text-[var(--muted)]">
          <li>条件を満たしたものが④でLINE通知の下書きになります。</li>
          <li>⑤の承認では、承認した瞬間の価格をもう一度確かめ、仕入上限を超えていれば発注を止めます。</li>
          <li>目標販売価格と損切りラインは、そのまま⑥⑦の売り時・撤退の基準になります。</li>
        </ul>
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Rules />
    </SetupGuard>
  );
}
