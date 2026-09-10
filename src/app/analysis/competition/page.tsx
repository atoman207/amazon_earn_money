import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { pct, yen } from "@/lib/format";
import { analyzeUniverse } from "@/lib/server/steps/analysis";

export const dynamic = "force-dynamic";

async function Competition() {
  const { rows } = await analyzeUniverse();
  const monopoly = rows.filter((r) => r.offerCount <= 1);
  const crowded = rows.filter((r) => r.offerCount > 15);
  const increasing = rows.filter((r) => (r.offerDelta ?? 0) > 0);
  const avgOffers = rows.length ? rows.reduce((a, r) => a + r.offerCount, 0) / rows.length : 0;

  return (
    <StepShell stepKey="analysis" sub="competition">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="平均の競合数" value={`${avgOffers.toFixed(1)}社`} sub={`${rows.length}件の平均`} />
        <Stat label="独占（1社以下）" value={`${monopoly.length}件`} tone="good" />
        <Stat
          label="競合過多（16社以上）"
          value={`${crowded.length}件`}
          sub="値下げ合戦になりやすい"
          tone={crowded.length > 0 ? "bad" : "good"}
        />
        <Stat
          label="7日で競合が増えた"
          value={`${increasing.length}件`}
          tone={increasing.length > 0 ? "warn" : "default"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          競合は2つの形で効きます。ひとつは<span className="font-bold">売れるまでの日数</span>
          （競合が倍になれば期待日数も倍）。もうひとつは<span className="font-bold">リスク係数</span>で、
          5社を超えたぶんだけ1社につき3%ずつ、期待値を割り引きます（下限40%）。
          価格の面では、いまの市場価格が中央値をどれだけ下回っているかで値下げ圧力を見ます。
        </Callout>
      </div>

      <Card className="mt-4" title="競合の状況（多い順）">
        {rows.length === 0 ? (
          <Empty>商品がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[920px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>競合</Th>
                  <Th right>7日の増減</Th>
                  <Th right>市場価格</Th>
                  <Th right>基準価格</Th>
                  <Th right>価格の下押し</Th>
                  <Th right>リスク係数</Th>
                  <Th>読み</Th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .sort((a, b) => b.offerCount - a.offerCount)
                  .slice(0, 60)
                  .map((r) => {
                    const pressure =
                      r.sellPrice !== null && r.reference ? r.sellPrice / r.reference - 1 : null;
                    return (
                      <tr key={r.asin}>
                        <Td>
                          <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                            {r.title}
                          </Link>
                          <span className="num text-[11px] text-[var(--muted)]">{r.asin}</span>
                        </Td>
                        <Td right>
                          <Badge tone={r.offerCount <= 5 ? "good" : r.offerCount <= 15 ? "warn" : "bad"}>
                            {r.offerCount}社
                          </Badge>
                        </Td>
                        <Td right className="text-xs">
                          {r.offerDelta === null ? (
                            <span className="text-[var(--muted)]">—</span>
                          ) : r.offerDelta === 0 ? (
                            <span className="text-[var(--muted)]">変わらず</span>
                          ) : (
                            <span className={r.offerDelta > 0 ? "text-[var(--bad)]" : "text-[var(--good)]"}>
                              {r.offerDelta > 0 ? "+" : ""}
                              {r.offerDelta}
                            </span>
                          )}
                        </Td>
                        <Td right className="text-xs">{yen(r.sellPrice)}</Td>
                        <Td right className="text-xs text-[var(--muted)]">{yen(r.reference)}</Td>
                        <Td right className="text-xs">
                          {pressure === null ? (
                            "—"
                          ) : (
                            <span className={pressure < -0.05 ? "text-[var(--bad)]" : ""}>{pct(pressure, 1)}</span>
                          )}
                        </Td>
                        <Td right className="num text-xs">
                          {r.evaluation ? r.evaluation.riskFactor.toFixed(2) : "—"}
                        </Td>
                        <Td className="text-xs text-[var(--muted)]">
                          {r.offerCount <= 1
                            ? "独占。値付けが効きます"
                            : r.offerCount <= 5
                              ? "扱いやすい水準"
                              : r.offerCount <= 15
                                ? "回転が落ちます"
                                : "値下げ合戦になります"}
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
      <Competition />
    </SetupGuard>
  );
}
