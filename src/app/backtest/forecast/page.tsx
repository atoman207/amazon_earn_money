import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { ForecastChart, type ForecastChartPoint } from "@/components/ForecastChart";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { describeForecast, forecastPrice } from "@/lib/domain/forecast";
import { pct, yen } from "@/lib/format";
import { forecastView } from "@/lib/server/steps/judge";
import { loadAsin } from "@/lib/server/steps/universe";

export const dynamic = "force-dynamic";

const HORIZON = 30;

const DIRECTION: Record<string, { label: string; tone: "good" | "bad" | "default" }> = {
  up: { label: "上昇", tone: "good" },
  down: { label: "下落", tone: "bad" },
  flat: { label: "横ばい", tone: "default" },
};

/** 実測と予測を1本の系列につなぐ */
function toChart(history: Array<{ date: string; price: number }>, points: Array<{ date: string; expected: number; low: number; high: number }>): ForecastChartPoint[] {
  const past: ForecastChartPoint[] = history
    .slice(-120)
    .map((h) => ({ date: h.date, actual: h.price, expected: null, band: null }));
  // 予測の線を実測の最後の点からつなぐ
  if (past.length) {
    past[past.length - 1] = { ...past[past.length - 1], expected: past[past.length - 1].actual };
  }
  const future: ForecastChartPoint[] = points.map((p) => ({
    date: p.date,
    actual: null,
    expected: p.expected,
    band: [p.low, p.high] as [number, number],
  }));
  return [...past, ...future];
}

async function Forecast({ asin }: { asin: string | null }) {
  const view = await forecastView(HORIZON);
  const selectedAsin = asin ?? view.rows[0]?.row.asin ?? null;
  const selected = selectedAsin ? await loadAsin(selectedAsin, 365) : null;
  const selectedForecast =
    selected && selected.daily.length >= 3
      ? forecastPrice({ history: selected.daily, horizonDays: HORIZON })
      : null;

  const down = view.rows.filter((r) => r.row.forecast?.direction === "down");
  const up = view.rows.filter((r) => r.row.forecast?.direction === "up");

  return (
    <StepShell stepKey="backtest" sub="forecast">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="予測を出せた銘柄" value={`${view.rows.length}件`} sub={`${HORIZON}日先まで`} />
        <Stat
          label="材料が十分"
          value={`${view.reliable}件`}
          sub="60日以上・20点以上の履歴"
          tone={view.reliable > 0 ? "good" : "warn"}
        />
        <Stat label="下落の見込み" value={`${down.length}件`} tone={down.length ? "bad" : "default"} />
        <Stat label="上昇の見込み" value={`${up.length}件`} tone={up.length ? "good" : "default"} />
      </div>

      <div className="mt-4">
        <Callout tone="warn" title="予測の読み方">
          過去の並びに直線をあて、1年ぶんの履歴があれば月ごとの癖を掛け合わせただけの単純な推定です。
          値引きの終了や新製品の登場のような「起きること」は読めません。
          中心の線ではなく<span className="font-bold">帯（80%の幅）</span>で見てください。
          材料が足りないものは「参考」と出し、判定には使いません。
        </Callout>
      </div>

      {selected && selectedForecast && (
        <Card
          className="mt-4"
          title={`${selected.product.title}`}
          action={
            <Link href={`/products/${selected.asin}`} className="text-xs text-[var(--accent)]">
              商品ページ
            </Link>
          }
        >
          <p className="mb-3 text-sm text-[var(--ink-soft)]">{describeForecast(selectedForecast, HORIZON)}</p>
          <ForecastChart data={toChart(selected.daily, selectedForecast.points)} />
          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-[var(--muted)]">1日あたりの変化</dt>
              <dd className="num font-semibold">{yen(selectedForecast.slopePerDay)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">当てはまり（R²）</dt>
              <dd className="num font-semibold">{selectedForecast.r2.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">ばらつき（標準偏差）</dt>
              <dd className="num font-semibold">{yen(selectedForecast.sigma)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">季節の癖</dt>
              <dd className="font-semibold">
                {selectedForecast.seasonalityApplied ? "使っています" : "履歴不足で未使用"}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <Card className="mt-4" title={`${HORIZON}日先の見通し（下落の大きい順）`}>
        {view.rows.length === 0 ? (
          <Empty>
            価格の記録がまだありません。①のデータ収集で価格推移がたまると、ここに予測が出ます。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[860px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>いまの価格</Th>
                  <Th right>{HORIZON}日後（中心）</Th>
                  <Th right>幅（80%）</Th>
                  <Th right>変化率</Th>
                  <Th>向き</Th>
                  <Th>材料</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.slice(0, 60).map(({ row }) => {
                  const f = row.forecast!;
                  const last = f.points[f.points.length - 1];
                  const dir = DIRECTION[f.direction];
                  return (
                    <tr key={row.asin}>
                      <Td>
                        <Link
                          href={`/backtest/forecast?asin=${row.asin}`}
                          className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                        >
                          {row.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{row.asin}</span>
                      </Td>
                      <Td right className="text-xs">{yen(f.lastPrice)}</Td>
                      <Td right className="font-semibold">{last ? yen(last.expected) : "—"}</Td>
                      <Td right className="text-xs text-[var(--muted)]">
                        {last ? `${yen(last.low)}〜${yen(last.high)}` : "—"}
                      </Td>
                      <Td right className="text-xs">
                        {f.changeRate === null ? "—" : pct(f.changeRate, 1)}
                      </Td>
                      <Td>
                        <Badge tone={dir.tone}>{dir.label}</Badge>
                      </Td>
                      <Td>
                        <Badge tone={f.reliable ? "good" : "warn"}>
                          {f.reliable ? `R²=${f.r2.toFixed(2)}` : "参考"}
                        </Badge>
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

export default async function Page({ searchParams }: PageProps<"/backtest/forecast">) {
  const { asin } = await searchParams;
  const selected = typeof asin === "string" && asin.trim() ? asin.trim() : null;

  return (
    <SetupGuard>
      <Forecast asin={selected} />
    </SetupGuard>
  );
}
