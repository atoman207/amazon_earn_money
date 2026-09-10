import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { pct, yen } from "@/lib/format";
import { crashView } from "@/lib/server/steps/risk";

export const dynamic = "force-dynamic";

const SEVERITY: Record<string, { label: string; tone: "bad" | "warn" | "good" }> = {
  crash: { label: "急落", tone: "bad" },
  watch: { label: "注意", tone: "warn" },
  calm: { label: "落ち着いている", tone: "good" },
};

async function Crash() {
  const { rows, crashes } = await crashView();
  const watching = rows.filter((r) => r.severity === "watch");
  const heldCrash = rows.filter((r) => r.severity === "crash" && r.held);
  const noData = rows.filter((r) => r.weekChange === null);

  return (
    <StepShell stepKey="risk" sub="crash">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="急落している" value={`${crashes}件`} sub="7日で15%以上の下落" tone={crashes ? "bad" : "good"} />
        <Stat
          label="そのうち保有中"
          value={`${heldCrash.length}件`}
          sub="売却の判断が要ります"
          tone={heldCrash.length ? "bad" : "good"}
        />
        <Stat label="注意" value={`${watching.length}件`} sub="7%以上の下落か競合の急増" tone={watching.length ? "warn" : "default"} />
        <Stat
          label="判定できない"
          value={`${noData.length}件`}
          sub="7日前の価格がありません"
          tone={noData.length ? "warn" : "good"}
        />
      </div>

      <div className="mt-4">
        <Callout tone={heldCrash.length ? "bad" : "info"}>
          急落は2つの見方で拾います。ひとつは<span className="font-bold">価格</span>
          （7日で15%以上下がったら急落、7%以上なら注意）。
          もうひとつは<span className="font-bold">競合</span>で、7日で3社以上増えたものは
          これから値崩れが起きる前触れとして注意に入れます。
          保有中なら売却の判断、候補なら見送りの判断に使ってください。
        </Callout>
      </div>

      <Card className="mt-4" title="値動きの監視（危ない順）">
        {rows.length === 0 ? (
          <Empty>商品がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[980px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th>状態</Th>
                  <Th right>いまの価格</Th>
                  <Th right>7日前</Th>
                  <Th right>7日の変化</Th>
                  <Th right>30日中央値との差</Th>
                  <Th right>競合</Th>
                  <Th>読み</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r) => {
                  const s = SEVERITY[r.severity];
                  return (
                    <tr key={r.asin}>
                      <Td>
                        <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {r.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">
                          {r.asin}
                          {r.held && <span className="ml-1 text-[var(--accent)]">保有中</span>}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </Td>
                      <Td right className="text-xs">{r.current === null ? "—" : yen(r.current)}</Td>
                      <Td right className="text-xs text-[var(--muted)]">
                        {r.weekAgo === null ? "—" : yen(r.weekAgo)}
                      </Td>
                      <Td right>
                        {r.weekChange === null ? (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        ) : (
                          <span
                            className={`num text-xs ${
                              r.weekChange <= -0.15
                                ? "font-bold text-[var(--bad)]"
                                : r.weekChange < 0
                                  ? "text-[var(--warn)]"
                                  : "text-[var(--good)]"
                            }`}
                          >
                            {pct(r.weekChange, 1)}
                          </span>
                        )}
                      </Td>
                      <Td right className="num text-xs text-[var(--muted)]">
                        {r.vsMedian === null ? "—" : pct(r.vsMedian, 1)}
                      </Td>
                      <Td right className="text-xs">
                        {r.offerCount}社
                        {r.offerDelta !== null && r.offerDelta > 0 && (
                          <span className="ml-1 text-[var(--bad)]">+{r.offerDelta}</span>
                        )}
                      </Td>
                      <Td className="text-xs text-[var(--muted)]">{r.note}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {heldCrash.length > 0 && (
        <Card className="mt-4" title="保有中で急落しているもの">
          <ul className="space-y-2">
            {heldCrash.map((r) => (
              <li key={r.asin} className="rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-soft)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{r.title}</span>
                  <span className="num text-xs">
                    {r.weekAgo === null ? "" : `${yen(r.weekAgo)} → `}
                    {r.current === null ? "" : yen(r.current)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">{r.note}</p>
                <Link href="/risk/stoploss" className="mt-2 inline-block text-xs underline">
                  損切りラインを確認する
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Crash />
    </SetupGuard>
  );
}
