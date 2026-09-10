import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { dateTime, pct, yen } from "@/lib/format";
import { analyzeUniverse } from "@/lib/server/steps/analysis";

export const dynamic = "force-dynamic";

const PATTERN_LABEL: Record<string, string> = {
  timesale: "タイムセール",
  business: "ビジネス価格",
  demand: "品薄・人気化",
  oos: "本体OOS",
  bottom: "底値",
};

/** これ以上下がっていれば「値引き」と呼ぶ */
const MEANINGFUL = 0.15;

async function Spread() {
  const { rows } = await analyzeUniverse();
  const withReference = rows.filter((r) => r.reference && r.buyPrice);
  const discounted = withReference.filter((r) => (r.discountRate ?? 0) >= MEANINGFUL);
  const best = withReference
    .slice()
    .sort((a, b) => (b.discountRate ?? -1) - (a.discountRate ?? -1))[0];

  return (
    <StepShell stepKey="analysis" sub="spread">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="比較できた商品" value={`${withReference.length}件`} sub={`全 ${rows.length}件`} />
        <Stat
          label="15%以上の値引き"
          value={`${discounted.length}件`}
          sub="ここから②以降の判定に進みます"
          tone={discounted.length > 0 ? "good" : "default"}
        />
        <Stat
          label="いちばん深い値引き"
          value={best?.discountRate == null ? "—" : pct(best.discountRate, 1)}
          sub={best?.title.slice(0, 18) ?? "—"}
        />
        <Stat
          label="基準価格が出せない"
          value={`${rows.length - withReference.length}件`}
          sub="価格履歴が足りません"
          tone={rows.length - withReference.length > 0 ? "warn" : "good"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          基準価格は「その商品のふだんの値段」で、過去90日の市場価格の中央値を使います
          （90日ぶんが無いときは180日・365日の順に落とします）。
          値引き率は <span className="num">1 −（いまの仕入価格 ÷ 基準価格）</span> です。
          セール表示の割引率ではなく、実際の相場と比べた差だけを見ます。
        </Callout>
      </div>

      <Card className="mt-4" title="価格差（大きい順）">
        {withReference.length === 0 ? (
          <Empty>
            比較できる商品がありません。①のデータ収集で価格履歴をためてください。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[860px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>いまの仕入価格</Th>
                  <Th right>基準価格</Th>
                  <Th right>差額</Th>
                  <Th right>値引き率</Th>
                  <Th right>90日最安</Th>
                  <Th>型</Th>
                  <Th>最終観測</Th>
                </tr>
              </thead>
              <tbody>
                {withReference
                  .slice()
                  .sort((a, b) => (b.discountRate ?? -1) - (a.discountRate ?? -1))
                  .slice(0, 60)
                  .map((r) => {
                    const gap = r.reference !== null && r.buyPrice !== null ? r.reference - r.buyPrice : null;
                    return (
                      <tr key={r.asin}>
                        <Td>
                          <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                            {r.title}
                          </Link>
                          <span className="num text-[11px] text-[var(--muted)]">
                            {r.asin} / {r.category}
                          </span>
                        </Td>
                        <Td right className="font-semibold">{yen(r.buyPrice)}</Td>
                        <Td right>{yen(r.reference)}</Td>
                        <Td right className={gap && gap > 0 ? "text-[var(--good)]" : ""}>
                          {gap === null ? "—" : yen(gap)}
                        </Td>
                        <Td right>
                          {r.discountRate === null ? (
                            "—"
                          ) : (
                            <Badge tone={r.discountRate >= MEANINGFUL ? "good" : "default"}>
                              {pct(r.discountRate, 1)}
                            </Badge>
                          )}
                        </Td>
                        <Td right className="text-xs text-[var(--muted)]">{yen(r.min90)}</Td>
                        <Td className="text-xs">{PATTERN_LABEL[r.pattern] ?? r.pattern}</Td>
                        <Td className="text-xs text-[var(--muted)]">{dateTime(r.observedAt)}</Td>
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
      <Spread />
    </SetupGuard>
  );
}
