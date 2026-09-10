import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateTime, days, pct, yen } from "@/lib/format";
import { latestAnalysis, type NicheCandidate } from "@/lib/server/ai";
import { precisionView } from "@/lib/server/steps/review";

export const dynamic = "force-dynamic";

async function Precision() {
  const [view, latest] = await Promise.all([precisionView(), latestAnalysis("niche")]);
  const r = view.result;
  const aiEnabled = Boolean(process.env.OPENROUTER_API_KEY);
  const items = ((latest?.output as { items?: NicheCandidate[] } | null)?.items ?? []) as NicheCandidate[];

  const groupTable = (title: string, groups: typeof r.byJudgment, header: string) => (
    <Card title={title}>
      {groups.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="row-hover w-full min-w-[400px]">
            <thead>
              <tr>
                <Th>{header}</Th>
                <Th right>件数</Th>
                <Th right>勝率</Th>
                <Th right>利益のズレ</Th>
                <Th right>日数のズレ</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <Td className="text-sm">{g.key}</Td>
                  <Td right className="text-xs">{g.count}</Td>
                  <Td right className="text-xs">{pct(g.hitRate, 0)}</Td>
                  <Td right>
                    <Money value={g.profitGap} signed />
                  </Td>
                  <Td right className="num text-xs">
                    {g.daysGap > 0 ? "+" : ""}
                    {g.daysGap.toFixed(0)}日
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <StepShell
      stepKey="review"
      sub="precision"
      actions={
        <form action="/api/ai/niche" method="post">
          <button className="btn btn-soft" disabled={!aiEnabled}>
            AIでニッチを探す
          </button>
        </form>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="答え合わせできた売却"
          value={`${r.count}件`}
          sub={view.unmatched > 0 ? `${view.unmatched}件は判定までたどれません` : undefined}
        />
        <Stat
          label="読みが当たった割合"
          value={r.hitRate === null ? "—" : pct(r.hitRate, 0)}
          sub="利益が出た割合"
          tone={r.hitRate !== null && r.hitRate >= 0.6 ? "good" : "default"}
        />
        <Stat
          label="利益のズレ（実績 − 見込み）"
          value={r.profitBias === null ? "—" : yen(r.profitBias)}
          sub={r.profitErrorRate === null ? undefined : `誤差の中央値 ${pct(r.profitErrorRate, 0)}`}
          tone={r.profitBias === null ? "default" : r.profitBias >= 0 ? "good" : "bad"}
        />
        <Stat
          label="日数のズレ"
          value={r.daysBias === null ? "—" : `${r.daysBias > 0 ? "+" : ""}${r.daysBias.toFixed(0)}日`}
          sub="正なら思ったより時間がかかった"
          tone={r.daysBias !== null && Math.abs(r.daysBias) > 7 ? "warn" : "default"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          「買ってよい」と判定したものが、実際に利益になったかを1件ずつ突き合わせています。
          見たいのは勝ち負けそのものより<span className="font-bold">読みのズレの向き</span>で、
          いつも利益を多めに見積もっているなら、想定販売価格か手数料の置き方に原因があります。
          売却 → 在庫 → 発注 → 候補 とたどれるものだけを対象にしています。
        </Callout>
      </div>

      {r.findings.length > 0 && (
        <div className="mt-4 space-y-2">
          {r.findings.map((f) => (
            <Callout key={f} tone="warn">
              {f}
            </Callout>
          ))}
        </div>
      )}

      {!r.enough && (
        <div className="mt-4">
          <Empty>
            答え合わせできた売却が {r.count}件です。5件を超えると、読みのズレから言えることを出します。
          </Empty>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {groupTable("判定ラベル別", r.byJudgment, "判定")}
        {groupTable("値引きの型別", r.byPattern, "型")}
        {groupTable("信頼度別", r.byConfidence, "信頼度")}
      </div>

      <Card className="mt-4" title="1件ずつの答え合わせ">
        {view.rows.length === 0 ? (
          <Empty>
            まだありません。⑤で承認した在庫を⑥で売却まで記録すると、ここに並びます。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[900px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th>判定</Th>
                  <Th right>見込み利益</Th>
                  <Th right>実際</Th>
                  <Th right>差</Th>
                  <Th right>見込み日数</Th>
                  <Th right>実際</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.slice(0, 60).map((row, i) => (
                  <tr key={`${row.asin}-${i}`}>
                    <Td>
                      <Link href={`/products/${row.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                        {row.title}
                      </Link>
                      <span className="num text-[11px] text-[var(--muted)]">{row.asin}</span>
                    </Td>
                    <Td>
                      <Badge tone={row.realizedProfit > 0 ? "good" : "bad"}>
                        {row.judgment === "buy"
                          ? "購入候補"
                          : row.judgment === "pilot"
                            ? "少量検証"
                            : row.judgment === "review"
                              ? "要確認"
                              : row.judgment === "skip"
                                ? "見送り"
                                : "判定なし"}
                      </Badge>
                    </Td>
                    <Td right className="text-xs">{yen(row.predictedProfit)}</Td>
                    <Td right>
                      <Money value={row.realizedProfit} />
                    </Td>
                    <Td right>
                      <Money value={row.realizedProfit - row.predictedProfit} signed />
                    </Td>
                    <Td right className="text-xs">{days(row.predictedDays)}</Td>
                    <Td right className="text-xs">{days(row.realizedDays)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title={latest ? `AIによるニッチ候補（${dateTime(latest.created_at)}）` : "AIによるニッチ候補"}
        >
          {!aiEnabled && (
            <Callout tone="warn">
              OPENROUTER_API_KEY が未設定です。設定すると、競合が少なく売れている商品を
              理由つきで挙げてくれます。
            </Callout>
          )}
          {items.length === 0 ? (
            <div className={aiEnabled ? "" : "mt-3"}>
              <Empty>分析結果はまだありません</Empty>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((i) => (
                <li key={i.asin} className="rounded-lg border border-[var(--line)] p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.verdict === "狙い目" ? "good" : i.verdict === "避ける" ? "bad" : "warn"}>
                      {i.verdict}
                    </Badge>
                    <span className="num text-[11px] text-[var(--muted)]">
                      確度 {Math.round((i.confidence ?? 0) * 100)}% / {i.asin}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{i.title}</div>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">{i.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="AIに任せていること／任せていないこと">
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-[var(--good)]/30 bg-[var(--good-soft)] p-3">
              <h3 className="text-xs font-bold text-[var(--good)]">AIが行うこと</h3>
              <ul className="mt-1.5 space-y-1 text-[11px] text-[var(--ink-soft)]">
                <li>売れ筋の判定（ランキングと価格の動きの読み解き）</li>
                <li>新商品・ニッチの発見</li>
                <li>商品説明から危険な商品を見つけて候補から外す</li>
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] p-3">
              <h3 className="text-xs font-bold text-[var(--warn)]">AIに任せないこと</h3>
              <ul className="mt-1.5 space-y-1 text-[11px] text-[var(--ink-soft)]">
                <li>利益の計算（すべて決まった計算式で行います）</li>
                <li>買う・売るの判定（閾値の判断はコードが行います）</li>
                <li>金額の生成（AIが出した数字は使いません）</li>
              </ul>
            </div>
          </div>
          <Link href="/review/logic" className="btn mt-3 w-full">
            ロジックの改善へ
          </Link>
        </Card>
      </div>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Precision />
    </SetupGuard>
  );
}
