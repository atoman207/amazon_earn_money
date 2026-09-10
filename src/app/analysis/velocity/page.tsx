import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { days, pct } from "@/lib/format";
import { analyzeUniverse } from "@/lib/server/steps/analysis";

export const dynamic = "force-dynamic";

async function Velocity() {
  const { rows, settings } = await analyzeUniverse();
  const withSales = rows.filter((r) => r.salesPerDay > 0);
  const fast = rows.filter(
    (r) => r.evaluation && r.evaluation.expectedDays <= settings.thresholds.maxExpectedDays,
  );
  const rising = rows.filter((r) => r.rankTrend < -0.1);

  return (
    <StepShell stepKey="analysis" sub="velocity">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="売れた形跡がある"
          value={`${withSales.length}件`}
          sub={`全 ${rows.length}件`}
          tone={withSales.length > 0 ? "good" : "warn"}
        />
        <Stat
          label={`${settings.thresholds.maxExpectedDays}日以内に売れる見込み`}
          value={`${fast.length}件`}
          tone={fast.length > 0 ? "good" : "default"}
        />
        <Stat label="需要が伸びている" value={`${rising.length}件`} sub="ランキングが10%以上改善" />
        <Stat
          label="売れ行き不明"
          value={`${rows.length - withSales.length}件`}
          sub="ランキングの記録が足りません"
          tone={rows.length - withSales.length > 0 ? "warn" : "good"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          売れ行きは、販売ランキングが10%以上良くなった回数を「1個売れた」とみなして数え、
          観測期間で割って <span className="num">1日あたり販売数</span> を出します。
          そこから <span className="num">売れるまでの日数 ＝ 競合数 ÷ 1日あたり販売数</span>、
          <span className="num"> 期間内に売れる確率 ＝ 1 − exp(−1日あたり販売数 × 日数 ÷ 競合数)</span> を出します。
          売れた形跡が無い商品は「売れない」として扱い、候補から外します。
        </Callout>
      </div>

      <Card className="mt-4" title="売れ行き（速い順）">
        {rows.length === 0 ? (
          <Empty>商品がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[880px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>1日あたり販売数</Th>
                  <Th right>競合</Th>
                  <Th right>売れるまで</Th>
                  <Th right>期間内に売れる確率</Th>
                  <Th right>現在の順位</Th>
                  <Th>ランキングの動き</Th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .sort((a, b) => {
                    const da = a.evaluation?.expectedDays ?? Number.POSITIVE_INFINITY;
                    const db = b.evaluation?.expectedDays ?? Number.POSITIVE_INFINITY;
                    return da - db;
                  })
                  .slice(0, 60)
                  .map((r) => {
                    const e = r.evaluation;
                    const withinLimit =
                      e && e.expectedDays <= settings.thresholds.maxExpectedDays;
                    return (
                      <tr key={r.asin}>
                        <Td>
                          <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                            {r.title}
                          </Link>
                          <span className="num text-[11px] text-[var(--muted)]">{r.asin}</span>
                        </Td>
                        <Td right className="num text-xs">
                          {r.salesPerDay > 0 ? r.salesPerDay.toFixed(2) : "—"}
                        </Td>
                        <Td right className="text-xs">{r.offerCount}社</Td>
                        <Td right>
                          {!e ? (
                            <span className="text-xs text-[var(--muted)]">—</span>
                          ) : (
                            <Badge tone={withinLimit ? "good" : "bad"}>{days(e.expectedDays)}</Badge>
                          )}
                        </Td>
                        <Td right className="text-xs">{e ? pct(e.sellProbability, 0) : "—"}</Td>
                        <Td right className="num text-xs text-[var(--muted)]">
                          {r.latestRank === null ? "—" : `${r.latestRank.toLocaleString("ja-JP")}位`}
                        </Td>
                        <Td className="text-xs">
                          {r.rankTrend < -0.1 ? (
                            <span className="text-[var(--good)]">良くなっています</span>
                          ) : r.rankTrend > 0.1 ? (
                            <span className="text-[var(--bad)]">鈍っています</span>
                          ) : (
                            <span className="text-[var(--muted)]">横ばい</span>
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
      <Velocity />
    </SetupGuard>
  );
}
