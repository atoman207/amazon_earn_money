import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { days, pct, yen } from "@/lib/format";
import { analyzeUniverse } from "@/lib/server/steps/analysis";

export const dynamic = "force-dynamic";

async function Profit() {
  const { rows, settings, perItemCap } = await analyzeUniverse();
  const evaluated = rows.filter((r) => r.evaluation);
  const passed = evaluated.filter((r) => r.evaluation!.passed);
  const avgRoi = evaluated.length
    ? evaluated.reduce((a, r) => a + r.evaluation!.roi, 0) / evaluated.length
    : null;
  const totalProfit = passed.reduce((a, r) => a + r.evaluation!.netProfit, 0);

  return (
    <StepShell stepKey="analysis" sub="profit">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="利益を計算できた" value={`${evaluated.length}件`} sub={`全 ${rows.length}件`} />
        <Stat
          label="条件を満たす"
          value={`${passed.length}件`}
          sub={`純利益 ${yen(settings.thresholds.minNetProfit)}以上 / ROI ${pct(settings.thresholds.minRoi, 0)}以上`}
          tone={passed.length > 0 ? "good" : "default"}
        />
        <Stat label="平均ROI" value={avgRoi === null ? "—" : pct(avgRoi)} sub="計算できたもの全体" />
        <Stat label="通過分の純利益合計" value={yen(totalProfit)} sub={`1銘柄の上限 ${yen(perItemCap)}`} />
      </div>

      <div className="mt-4">
        <Callout>
          利益は「安く買えた差額」ではなく、
          <span className="font-bold">手数料をすべて引いたあとに残る金額</span>で判定します。
          <span className="num"> 手取り ＝ 想定販売価格 − 販売手数料 − 配送代行手数料 − 保管料 − 返品引当</span>、
          <span className="num"> 取得原価 ＝ 仕入価格 − ポイント還元 ＋ 入庫費用</span>、
          <span className="num"> 純利益 ＝ 手取り − 取得原価</span>。
          保管料は「売れるまでにかかる日数ぶん」を先に引きます。
        </Callout>
      </div>

      <Card className="mt-4" title="利益の内訳（純利益の大きい順）">
        {evaluated.length === 0 ? (
          <Empty>価格が取れている商品がありません。①のデータ収集から始めてください。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[1000px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>仕入</Th>
                  <Th right>想定販売</Th>
                  <Th right>販売手数料</Th>
                  <Th right>配送代行</Th>
                  <Th right>保管料</Th>
                  <Th right>返品引当</Th>
                  <Th right>取得原価</Th>
                  <Th right>純利益</Th>
                  <Th right>ROI</Th>
                  <Th>判定</Th>
                </tr>
              </thead>
              <tbody>
                {evaluated.slice(0, 50).map((r) => {
                  const e = r.evaluation!;
                  return (
                    <tr key={r.asin}>
                      <Td>
                        <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {r.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{r.asin}</span>
                      </Td>
                      <Td right className="text-xs">{yen(e.buyPrice)}</Td>
                      <Td right className="text-xs">{yen(e.expectedSellPrice)}</Td>
                      <Td right className="text-xs text-[var(--bad)]">−{yen(e.referralFee)}</Td>
                      <Td right className="text-xs text-[var(--bad)]">−{yen(e.fbaFee)}</Td>
                      <Td right className="text-xs text-[var(--bad)]">−{yen(e.storageFee)}</Td>
                      <Td right className="text-xs text-[var(--bad)]">−{yen(e.returnsAllowance)}</Td>
                      <Td right className="text-xs">{yen(e.acquisitionCost)}</Td>
                      <Td right>
                        <Money value={e.netProfit} />
                      </Td>
                      <Td right className="text-xs">{pct(e.roi)}</Td>
                      <Td>
                        {e.passed ? (
                          <Badge tone="good">通過</Badge>
                        ) : (
                          <Badge tone="bad" >{e.reasons[0] ?? "不通過"}</Badge>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="いま使っている費用の設定">
          <dl className="divide-y divide-[var(--line)]/60 text-sm">
            {[
              ["入庫費用（1個）", yen(settings.costs.inboundCostPerUnit)],
              ["ポイント還元率", pct(settings.costs.pointsBackRate, 2)],
              ["返品・値下げ引当", `販売価格の ${pct(settings.costs.returnsRate, 1)}`],
              ["保管料", `1日 ${yen(settings.costs.storageFeePerDay)}`],
              ["配送代行（小型／標準）", `${yen(settings.costs.fbaFeeByTier.small)} / ${yen(settings.costs.fbaFeeByTier.standard)}`],
              ["配送代行（大型／特大）", `${yen(settings.costs.fbaFeeByTier.large)} / ${yen(settings.costs.fbaFeeByTier.oversize)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2">
                <dt className="text-[var(--muted)]">{label}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
          </dl>
          <Link href="/settings" className="btn mt-3 w-full">
            費用の設定を開く
          </Link>
        </Card>

        <Card title="条件を満たさなかった理由">
          {evaluated.length === passed.length ? (
            <Empty>すべて条件を満たしています</Empty>
          ) : (
            <ul className="space-y-2">
              {evaluated
                .filter((r) => !r.evaluation!.passed)
                .slice(0, 12)
                .map((r) => (
                  <li key={r.asin} className="rounded-lg border border-[var(--line)] p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="line-clamp-1 text-xs">{r.title}</span>
                      <span className="num shrink-0 text-xs text-[var(--muted)]">
                        {yen(r.evaluation!.netProfit)} / {pct(r.evaluation!.roi)} / {days(r.evaluation!.expectedDays)}
                      </span>
                    </div>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {r.evaluation!.reasons.map((reason) => (
                        <li key={reason}>
                          <Badge tone="bad">{reason}</Badge>
                        </li>
                      ))}
                    </ul>
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
      <Profit />
    </SetupGuard>
  );
}
