import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { days, stars } from "@/lib/format";
import { analyzeUniverse } from "@/lib/server/steps/analysis";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, { label: string; tone: "good" | "warn" | "bad" }> = {
  ok: { label: "問題なし", tone: "good" },
  caution: { label: "注意", tone: "warn" },
  exclude: { label: "除外", tone: "bad" },
};

async function RiskCheck() {
  const { rows } = await analyzeUniverse();
  const excluded = rows.filter((r) => r.screen.verdict === "exclude");
  const caution = rows.filter((r) => r.screen.verdict === "caution");
  const ok = rows.filter((r) => r.screen.verdict === "ok");

  // どの理由で落ちているかを数える
  const reasons = new Map<string, number>();
  for (const r of rows) {
    for (const c of r.screen.checks) {
      reasons.set(c.label, (reasons.get(c.label) ?? 0) + 1);
    }
  }

  return (
    <StepShell stepKey="analysis" sub="risk">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="問題なし" value={`${ok.length}件`} tone="good" />
        <Stat label="注意が必要" value={`${caution.length}件`} tone={caution.length ? "warn" : "default"} />
        <Stat label="除外" value={`${excluded.length}件`} tone={excluded.length ? "bad" : "default"} />
        <Stat label="確認した商品" value={`${rows.length}件`} sub="在庫リスク・規制・履歴の状態" />
      </div>

      <div className="mt-4">
        <Callout>
          ここで見るのは「利益が出るか」ではなく「そもそも扱ってよいか」です。
          出品できない（許認可・証憑）、売れた形跡が無い、値動きが荒すぎる、競合が多すぎる、
          相場が仕入値を下回っている — このどれかに当たれば除外します。
          除外の判定は⑦の
          <Link href="/risk/exclude" className="ml-1 underline">
            事前除外
          </Link>
          と同じ規則を使っています。
        </Callout>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <Card title="引っかかった理由">
          {reasons.size === 0 ? (
            <Empty>ありません</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {[...reasons.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => (
                  <li key={label} className="flex justify-between gap-2">
                    <span className="text-[var(--muted)]">{label}</span>
                    <span className="num">{count}件</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card title="リスクチェックの結果" className="lg:col-span-3">
          {rows.length === 0 ? (
            <Empty>商品がありません</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[820px]">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th>判定</Th>
                    <Th>理由</Th>
                    <Th right>履歴</Th>
                    <Th right>信頼度</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 60).map((r) => {
                    const v = VERDICT[r.screen.verdict];
                    return (
                      <tr key={r.asin}>
                        <Td>
                          <Link href={`/products/${r.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                            {r.title}
                          </Link>
                          <span className="num text-[11px] text-[var(--muted)]">{r.asin}</span>
                        </Td>
                        <Td>
                          <Badge tone={v.tone}>{v.label}</Badge>
                        </Td>
                        <Td>
                          {r.screen.checks.length === 0 ? (
                            <span className="text-xs text-[var(--muted)]">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {r.screen.checks.map((c) => (
                                <li
                                  key={c.code}
                                  className={`text-[11px] ${c.level === "block" ? "text-[var(--bad)]" : "text-[var(--warn)]"}`}
                                >
                                  {c.level === "block" ? "✕" : "△"} {c.detail}
                                </li>
                              ))}
                            </ul>
                          )}
                        </Td>
                        <Td right className="text-xs text-[var(--muted)]">
                          {days(r.historyDays)} / {r.observationCount}件
                        </Td>
                        <Td right className="text-xs text-[var(--warn)]">
                          {r.evaluation ? stars(r.evaluation.confidence) : "—"}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <RiskCheck />
    </SetupGuard>
  );
}
