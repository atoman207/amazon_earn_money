import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Bar, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { pct } from "@/lib/format";
import { otherCollectSnapshot } from "@/lib/server/steps/collect";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = {
  small: "小型",
  standard: "標準",
  large: "大型",
  oversize: "特大",
};

async function OtherData() {
  const s = await otherCollectSnapshot();
  const maxCategory = Math.max(1, ...s.categories.map((c) => c.products));
  const seasonalityKnown = s.seasonality.filter((m) => m.index !== null);

  return (
    <StepShell stepKey="collect" sub="other">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="カテゴリ" value={`${s.categories.length}種`} sub="手数料率はカテゴリごとに違います" />
        <Stat
          label="出品ゲート"
          value={`${s.gates.find((g) => g.label === "PASS")?.count ?? 0}件 PASS`}
          sub={s.gates.map((g) => `${g.label} ${g.count}`).join(" / ")}
        />
        <Stat
          label="季節の癖が出せた月"
          value={`${seasonalityKnown.length}/12`}
          sub="1年ぶんの履歴で出せます"
          tone={seasonalityKnown.length >= 6 ? "good" : "warn"}
        />
        <Stat
          label="需要が伸びている銘柄"
          value={`${s.demand.filter((d) => d.change < 0).length}件`}
          sub="30日でランキングが改善"
          tone="good"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="カテゴリ">
          {s.categories.length === 0 ? (
            <Empty>商品がありません</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full">
                <thead>
                  <tr>
                    <Th>カテゴリ</Th>
                    <Th right>商品</Th>
                    <Th right>平均手数料率</Th>
                    <Th right>価格取得済み</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.categories.map((c) => (
                    <tr key={c.category}>
                      <Td>
                        <span className="text-sm">{c.category}</span>
                        <Bar value={c.products} max={maxCategory} height={4} />
                      </Td>
                      <Td right>{c.products}</Td>
                      <Td right className="text-xs">{pct(c.avgFeeRate, 1)}</Td>
                      <Td right className="text-xs text-[var(--muted)]">
                        {c.observed}/{c.products}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="季節性（月ごとの価格の癖）">
          {seasonalityKnown.length === 0 ? (
            <Empty>1年ぶんの価格履歴がたまると、月ごとの高い・安いが出ます</Empty>
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--muted)]">
                全期間の中央値を 1.00 としたときの、その月の価格水準です。1.00 より低い月は安く買える月です。
              </p>
              <ul className="space-y-1.5">
                {s.seasonality.map((m) => (
                  <li key={m.month} className="flex items-center gap-3">
                    <span className="num w-8 shrink-0 text-[11px] text-[var(--muted)]">{m.month}月</span>
                    <span className="min-w-0 flex-1">
                      <Bar
                        value={m.index ?? 0}
                        max={1.5}
                        color={m.index === null ? "var(--line)" : m.index < 1 ? "var(--good)" : "var(--warn)"}
                      />
                    </span>
                    <span className="num w-16 shrink-0 text-right text-[11px] text-[var(--muted)]">
                      {m.index === null ? `${m.samples}件` : m.index.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="需要トレンド（30日）" className="lg:col-span-2">
          {s.demand.length === 0 ? (
            <Empty>ランキングの記録がたまると、売れ行きの変化が出ます</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[560px]">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th right>現在の順位</Th>
                    <Th right>30日の変化</Th>
                    <Th>読み</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.demand.map((d) => (
                    <tr key={d.asin}>
                      <Td>
                        <Link href={`/products/${d.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {d.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{d.asin}</span>
                      </Td>
                      <Td right className="num text-xs">{d.latestRank.toLocaleString("ja-JP")}位</Td>
                      <Td right>
                        <Badge tone={d.change < 0 ? "good" : "default"}>
                          {d.change < 0 ? "" : "+"}
                          {(d.change * 100).toFixed(0)}%
                        </Badge>
                      </Td>
                      <Td className="text-xs text-[var(--muted)]">
                        {d.change < -0.2 ? "売れ行きが良くなっています" : d.change < 0 ? "やや改善" : "横ばい〜鈍化"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="サイズ区分">
            {s.sizeTiers.length === 0 ? (
              <Empty>—</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {s.sizeTiers.map((t) => (
                  <li key={t.tier} className="flex justify-between">
                    <span className="text-[var(--muted)]">{TIER_LABEL[t.tier] ?? t.tier}</span>
                    <span className="num">{t.count}件</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
              配送代行手数料はサイズ区分で決まります。区分を間違えると利益の計算がずれます。
            </p>
          </Card>

          <Card title="レビュー">
            <Callout tone="warn">{s.reviews.note}</Callout>
          </Card>
        </div>
      </div>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <OtherData />
    </SetupGuard>
  );
}
