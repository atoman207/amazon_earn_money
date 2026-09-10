import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Stat } from "@/components/ui";
import { failureLabel } from "@/lib/domain/improve";
import { days, pct } from "@/lib/format";
import { logicView } from "@/lib/server/steps/review";

export const dynamic = "force-dynamic";

const KEY_LABEL: Record<string, string> = {
  minNetProfit: "最低純利益",
  minRoi: "最低利益率",
  maxExpectedDays: "期待保有日数の上限",
  minConfidence: "データ信頼度の下限",
  stopLossRate: "価格損切りライン",
  timeStopDays: "値下げを始める日数",
  forceSellDays: "成行売却する日数",
  trailingDrop: "トレーリング利確",
  storageRatioCap: "保管費の上限",
};

async function Logic({ applied }: { applied: boolean }) {
  const { improve, settings } = await logicView();

  return (
    <StepShell stepKey="review" sub="logic">
      {applied && (
        <div className="mb-4">
          <Callout tone="good">設定に反映しました。次の判定から新しい値で動きます。</Callout>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="判断材料にした売却" value={`${improve.sampleCount}件`} sub="10件を超えると提案します" />
        <Stat
          label="勝率"
          value={improve.winRate === null ? "—" : pct(improve.winRate, 0)}
          tone={improve.winRate !== null && improve.winRate >= 0.6 ? "good" : "default"}
        />
        <Stat label="平均保有日数" value={days(improve.avgHoldingDays)} />
        <Stat
          label="提案"
          value={`${improve.suggestions.length}件`}
          tone={improve.suggestions.length > 0 ? "warn" : "good"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          設定は自動では変えません。「勝率が低いから利益の下限を上げる」のように、
          <span className="font-bold">実績にもとづく理由</span>と一緒に提案し、
          反映するかどうかは人が決めます。勝手に締めたり緩めたりすると、
          なぜその設定になっているのか誰にも分からなくなるためです。
          反映した記録は監査ログに残ります。
        </Callout>
      </div>

      <Card className="mt-4" title="設定の見直し提案">
        {!improve.enough ? (
          <Empty>
            売却の実績が {improve.sampleCount}件です。10件を超えると、勝率・保有日数・損の原因から
            提案を出します。
          </Empty>
        ) : improve.suggestions.length === 0 ? (
          <Callout tone="good">
            いまの設定で問題は見つかりませんでした（{improve.sampleCount}件の実績、勝率{" "}
            {pct(improve.winRate ?? 0, 0)}）。
          </Callout>
        ) : (
          <ul className="space-y-3">
            {improve.suggestions.map((s, i) => (
              <li key={`${s.key}-${i}`} className="rounded-lg border border-[var(--line)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.direction === "tighten" ? "warn" : "good"}>
                    {s.direction === "tighten" ? "厳しくする" : "ゆるめる"}
                  </Badge>
                  <span className="text-sm font-semibold">{KEY_LABEL[s.key] ?? s.label}</span>
                  <span className="num text-sm text-[var(--muted)]">
                    {s.current} → <span className="font-bold text-[var(--ink)]">{s.suggested}</span>
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{s.reason}</p>
                <form action="/api/review/apply" method="post" className="mt-2 flex items-center gap-2">
                  <input type="hidden" name="key" value={s.key} />
                  <input type="hidden" name="value" value={s.suggested} />
                  <button className="btn btn-primary text-xs">この値に変える</button>
                  <Link href="/settings" className="btn text-xs">
                    設定で手直しする
                  </Link>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="いまの判定条件">
          <dl className="divide-y divide-[var(--line)]/60 text-sm">
            {[
              ["最低純利益", `${settings.thresholds.minNetProfit.toLocaleString("ja-JP")}円`],
              ["最低利益率", pct(settings.thresholds.minRoi, 0)],
              ["期待保有日数の上限", `${settings.thresholds.maxExpectedDays}日`],
              ["データ信頼度の下限", settings.thresholds.minConfidence.toFixed(2)],
              ["価格損切りライン", pct(settings.thresholds.stopLossRate, 0)],
              ["値下げを始める日数", `${settings.thresholds.timeStopDays}日`],
              ["成行売却する日数", `${settings.thresholds.forceSellDays}日`],
              ["トレーリング利確", pct(settings.thresholds.trailingDrop, 0)],
              ["保管費の上限", pct(settings.thresholds.storageRatioCap, 0)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2">
                <dt className="text-[var(--muted)]">{label}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="損の原因（提案の根拠）">
          {improve.failureBreakdown.length === 0 ? (
            <Empty>原因が記録された損失はまだありません</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {improve.failureBreakdown.map((f) => (
                <li key={f.code} className="flex justify-between">
                  <span className="text-[var(--muted)]">{failureLabel(f.code)}</span>
                  <span className="num">{f.count}件</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
            原因は⑥で売却を記録するときに選びます。ここが埋まっているほど、提案の精度が上がります。
          </p>
        </Card>
      </div>
    </StepShell>
  );
}

export default async function Page({ searchParams }: PageProps<"/review/logic">) {
  const params = await searchParams;
  return (
    <SetupGuard>
      <Logic applied={params.applied === "1"} />
    </SetupGuard>
  );
}
