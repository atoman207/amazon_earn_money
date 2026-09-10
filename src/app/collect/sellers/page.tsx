import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Bar, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { sellerCollectSnapshot } from "@/lib/server/steps/collect";

export const dynamic = "force-dynamic";

async function Sellers() {
  const s = await sellerCollectSnapshot();
  const maxBucket = Math.max(1, ...s.buckets.map((b) => b.count));

  return (
    <StepShell stepKey="collect" sub="sellers">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="競合数が取れている"
          value={`${s.covered}件`}
          sub={s.missing > 0 ? `${s.missing}件は未取得` : "すべて取得済み"}
          tone={s.covered > 0 ? "good" : "warn"}
        />
        <Stat
          label="独占（1社以下）"
          value={`${s.buckets[0]?.count ?? 0}件`}
          sub="値付けの自由度が高い"
          tone="good"
        />
        <Stat label="狙い目（2〜5社）" value={`${s.buckets[1]?.count ?? 0}件`} />
        <Stat
          label="競合が増えた銘柄"
          value={`${s.increasing.length}件`}
          sub="7日前との比較"
          tone={s.increasing.length > 0 ? "warn" : "default"}
        />
      </div>

      {s.covered === 0 && (
        <div className="mt-4">
          <Callout tone="warn" title="競合数がまだ取れていません">
            出品者数は Keepa の取り込みで入ります。
            <Link href="/collect/keepa" className="ml-1 underline">
              Keepa API
            </Link>
            を設定してください。競合数が無いと、②の競合分析と売れるまでの日数が出せません。
          </Callout>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="競合数の分布">
          <ul className="space-y-3">
            {s.buckets.map((b) => (
              <li key={b.label}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{b.label}</span>
                  <span className="num text-xs text-[var(--muted)]">{b.count}件</span>
                </div>
                <Bar value={b.count} max={maxBucket} />
                <p className="mt-1 text-[11px] text-[var(--muted)]">{b.hint}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="競合が増えている銘柄" className="lg:col-span-2">
          {s.increasing.length === 0 ? (
            <Empty>7日前と比べて増えた銘柄はありません</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[520px]">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th right>7日前</Th>
                    <Th right>現在</Th>
                    <Th right>増減</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.increasing.map((r) => (
                    <tr key={r.asin}>
                      <Td>
                        <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {r.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{r.asin}</span>
                      </Td>
                      <Td right className="text-xs">{r.before ?? "—"}社</Td>
                      <Td right className="text-xs font-semibold">{r.current ?? "—"}社</Td>
                      <Td right>
                        <Badge tone={(r.delta ?? 0) >= 3 ? "bad" : "warn"}>+{r.delta}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="出品者情報（銘柄ごと）">
        {s.rows.length === 0 ? (
          <Empty>商品がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[640px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>競合数</Th>
                  <Th right>7日前</Th>
                  <Th right>増減</Th>
                  <Th>最終観測</Th>
                </tr>
              </thead>
              <tbody>
                {s.rows.slice(0, 60).map((r) => (
                  <tr key={r.asin}>
                    <Td>
                      <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                        {r.title}
                      </Link>
                      <span className="num text-[11px] text-[var(--muted)]">{r.asin}</span>
                    </Td>
                    <Td right className="font-semibold">
                      {r.current === null ? (
                        <span className="text-xs text-[var(--muted)]">未取得</span>
                      ) : (
                        `${r.current}社`
                      )}
                    </Td>
                    <Td right className="text-xs text-[var(--muted)]">
                      {r.before === null ? "—" : `${r.before}社`}
                    </Td>
                    <Td right>
                      {r.delta === null ? (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      ) : r.delta === 0 ? (
                        <span className="text-xs text-[var(--muted)]">変わらず</span>
                      ) : (
                        <Badge tone={r.delta > 0 ? "bad" : "good"}>
                          {r.delta > 0 ? "+" : ""}
                          {r.delta}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-xs text-[var(--muted)]">
                      {r.observedAt ? dateTime(r.observedAt) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="競合数をどう使うか">
        <ul className="space-y-1.5 text-xs text-[var(--muted)]">
          <li>売れるまでの日数 ＝ 競合数 ÷ 1日あたり販売数。競合が倍になれば、売れるまでも倍かかります。</li>
          <li>競合が5社を超えるぶんだけ、②のリスク係数を割り引きます。</li>
          <li>買った時点より競合が倍かつ5社以上になったら、⑦で売却を促します（X-3）。</li>
        </ul>
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Sellers />
    </SetupGuard>
  );
}
