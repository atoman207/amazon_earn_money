import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Bar, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { pct, yen } from "@/lib/format";
import { quantityPlan } from "@/lib/server/steps/purchase";

export const dynamic = "force-dynamic";

const LIMITED_BY: Record<string, string> = {
  kelly: "ケリー基準（勝ちやすさに対して賭けすぎない）",
  item: "1銘柄あたりの上限",
  category: "1カテゴリあたりの上限",
  cash: "使える現金",
  none: "制限なし",
};

async function Quantity() {
  const { rows, settings, capital } = await quantityPlan();
  const usage = capital.investable > 0 ? capital.deployed / capital.investable : 0;

  return (
    <StepShell stepKey="purchase" sub="quantity">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="運用資金" value={yen(capital.working)} sub={`現金留保 ${pct(settings.capital.cashReserveRatio, 0)}`} />
        <Stat label="投下できる上限" value={yen(capital.investable)} />
        <Stat
          label="いま使っている"
          value={yen(capital.deployed)}
          sub={`${pct(usage, 0)} を使用中`}
          tone={usage > 0.9 ? "warn" : "default"}
        />
        <Stat
          label="残り"
          value={yen(capital.available)}
          tone={capital.available > 0 ? "good" : "bad"}
        />
      </div>

      <div className="mt-2">
        <Bar value={capital.deployed} max={Math.max(1, capital.investable)} height={10} />
      </div>

      <div className="mt-4">
        <Callout>
          数量は<span className="font-bold">いちばん厳しい上限</span>に合わせます。
          ケリー基準（利益と損失の比・売れる確率から出る適正額に {pct(settings.capital.kellyFraction, 0)} を掛けたもの）、
          1銘柄 {pct(settings.capital.maxPerItemRatio, 0)}、1カテゴリ {pct(settings.capital.maxPerCategoryRatio, 0)}、
          そして手元に残っている現金 — この4つのうち最小のものが、その銘柄に使ってよい金額です。
          それを1個あたりの取得原価で割った数が推奨数量になります。
        </Callout>
      </div>

      <Card className="mt-4" title="銘柄ごとの数量">
        {rows.length === 0 ? (
          <Empty>承認待ちの候補がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[960px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>1個の取得原価</Th>
                  <Th right>使ってよい額</Th>
                  <Th right>資金から出る数量</Th>
                  <Th right>推奨数量</Th>
                  <Th right>合計</Th>
                  <Th right>ケリー</Th>
                  <Th>何が上限を決めたか</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.opportunity.id}>
                    <Td>
                      <Link
                        href={`/products/${r.opportunity.asin}`}
                        className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                      >
                        {r.product?.title ?? r.opportunity.asin}
                      </Link>
                      <span className="num text-[11px] text-[var(--muted)]">
                        {r.opportunity.asin}
                        {r.product?.category ? ` / ${r.product.category}` : ""}
                      </span>
                    </Td>
                    <Td right className="text-xs">{yen(r.unitCost)}</Td>
                    <Td right className="text-xs">{yen(r.allocation.perItemCap)}</Td>
                    <Td right className="text-xs">{r.qtyByCapital}個</Td>
                    <Td right className="font-semibold">{r.suggestedQty}個</Td>
                    <Td right className="text-xs">{yen(r.totalCost)}</Td>
                    <Td right className="num text-xs text-[var(--muted)]">
                      {(r.allocation.kellyRaw * 100).toFixed(1)}%
                    </Td>
                    <Td className="text-xs">
                      <Badge tone={r.allocation.limitedBy === "cash" ? "bad" : "default"}>
                        {LIMITED_BY[r.allocation.limitedBy] ?? r.allocation.limitedBy}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="カテゴリごとの投下額">
          {capital.byCategory.length === 0 ? (
            <Empty>まだ在庫がありません</Empty>
          ) : (
            <ul className="space-y-3">
              {capital.byCategory.map((c) => (
                <li key={c.category}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{c.category}</span>
                    <span className="num text-xs text-[var(--muted)]">
                      {yen(c.amount)} / 上限 {yen(c.cap)}
                    </span>
                  </div>
                  <Bar
                    value={c.amount}
                    max={Math.max(1, c.cap)}
                    color={c.amount >= c.cap ? "var(--bad)" : "var(--accent)"}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="上限を決める4つの制約">
          <dl className="divide-y divide-[var(--line)]/60 text-sm">
            {[
              ["ケリー係数", `${pct(settings.capital.kellyFraction, 0)}（推定の誤差を見込んで小さくします）`],
              ["1銘柄あたり", `運用資金の ${pct(settings.capital.maxPerItemRatio, 0)}`],
              ["1カテゴリあたり", `運用資金の ${pct(settings.capital.maxPerCategoryRatio, 0)}`],
              ["現金留保", `運用資金の ${pct(settings.capital.cashReserveRatio, 0)} は使いません`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 py-2">
                <dt className="shrink-0 text-[var(--muted)]">{label}</dt>
                <dd className="text-right text-xs">{value}</dd>
              </div>
            ))}
          </dl>
          <Link href="/settings" className="btn mt-3 w-full">
            資金配分の設定を開く
          </Link>
        </Card>
      </div>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Quantity />
    </SetupGuard>
  );
}
