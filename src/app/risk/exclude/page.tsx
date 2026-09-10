import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { days, yen } from "@/lib/format";
import { excludeView } from "@/lib/server/steps/risk";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, { label: string; tone: "good" | "warn" | "bad" }> = {
  ok: { label: "問題なし", tone: "good" },
  caution: { label: "注意", tone: "warn" },
  exclude: { label: "除外", tone: "bad" },
};

async function Exclude() {
  const view = await excludeView();
  const alreadyExcluded = view.rows.filter(
    (r) => (r.screen.checks.some((c) => c.code === "listing_gate")),
  );

  return (
    <StepShell stepKey="risk" sub="exclude">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="除外すべき" value={`${view.excluded}件`} tone={view.excluded ? "bad" : "good"} />
        <Stat label="注意して扱う" value={`${view.caution}件`} tone={view.caution ? "warn" : "default"} />
        <Stat label="問題なし" value={`${view.ok}件`} tone="good" />
        <Stat label="すでに手動で除外" value={`${alreadyExcluded.length}件`} sub="出品ゲートが FAIL" />
      </div>

      <div className="mt-4">
        <Callout>
          いちばん確実なリスク管理は<span className="font-bold">買わないこと</span>です。
          出品できない・売れた形跡がない・値動きが荒すぎる・競合が多すぎる・相場が仕入値を割っている・
          下落が続く見込み — このどれかに当たるものは、利益が大きく見えても外します。
          「除外する」を押すと出品ゲートが FAIL になり、⑤で承認できなくなります（監視も止まり、待機中の候補も見送りになります）。
        </Callout>
      </div>

      <Card className="mt-4" title="判定と操作">
        {view.rows.length === 0 ? (
          <Empty>商品がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[1040px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th>判定</Th>
                  <Th>外すべき理由</Th>
                  <Th right>仕入価格</Th>
                  <Th right>純利益</Th>
                  <Th right>履歴</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.slice(0, 60).map((r) => {
                  const v = VERDICT[r.screen.verdict];
                  const gate = r.screen.checks.find((c) => c.code === "listing_gate");
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
                      <Td>
                        <Badge tone={v.tone}>{v.label}</Badge>
                      </Td>
                      <Td>
                        {r.screen.blocks.length === 0 && r.screen.warns.length === 0 ? (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {r.screen.blocks.map((c) => (
                              <li key={c.code} className="text-[11px] text-[var(--bad)]">
                                ✕ {c.detail}
                              </li>
                            ))}
                            {r.screen.warns.map((c) => (
                              <li key={c.code} className="text-[11px] text-[var(--warn)]">
                                △ {c.detail}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      <Td right className="text-xs">{yen(r.buyPrice)}</Td>
                      <Td right className="text-xs">
                        {r.evaluation ? yen(r.evaluation.netProfit) : "—"}
                      </Td>
                      <Td right className="text-xs text-[var(--muted)]">{days(r.historyDays)}</Td>
                      <Td>
                        {gate ? (
                          <form action="/api/risk/exclude" method="post">
                            <input type="hidden" name="asin" value={r.asin} />
                            <input type="hidden" name="action" value="include" />
                            <button className="btn text-xs">除外を解除</button>
                          </form>
                        ) : (
                          <form action="/api/risk/exclude" method="post" className="flex items-center gap-1">
                            <input type="hidden" name="asin" value={r.asin} />
                            <input type="hidden" name="action" value="exclude" />
                            <input
                              name="reason"
                              placeholder="理由（任意）"
                              className="field field-inline text-xs"
                              defaultValue={r.screen.blocks[0]?.label ?? ""}
                            />
                            <button className="btn text-xs">除外する</button>
                          </form>
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

      <Card className="mt-4" title="自動で外している条件">
        <ul className="space-y-1.5 text-xs text-[var(--muted)]">
          <li>出品ゲートが PASS でない（許認可・証憑が未確認のものを含む）→ 承認できません</li>
          <li>売れた形跡がない（ランキングの改善が観測されていない）</li>
          <li>値動きの変動係数が 0.40 以上／競合が 25社以上</li>
          <li>90日中央値が仕入価格を下回っている（値引きが恒久化）</li>
          <li>予測で 10%以上の下落が見込まれる（材料が十分なときのみ）</li>
        </ul>
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Exclude />
    </SetupGuard>
  );
}
