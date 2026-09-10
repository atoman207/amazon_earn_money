import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Stat } from "@/components/ui";
import { notifySettingsView } from "@/lib/server/steps/notify";

export const dynamic = "force-dynamic";

function Field({
  name,
  label,
  value,
  suffix,
  hint,
  min,
  max,
}: {
  name: string;
  label: string;
  value: number;
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input name={name} defaultValue={value} type="number" min={min} max={max} className="field num" />
        {suffix && <span className="shrink-0 text-xs text-[var(--muted)]">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

async function NotifySettings({ saved }: { saved: boolean }) {
  const view = await notifySettingsView();

  return (
    <StepShell stepKey="notify" sub="settings">
      {saved && (
        <div className="mb-4">
          <Callout tone="good">通知の設定を保存しました。</Callout>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="待っている候補" value={`${view.pending}件`} />
        <Stat label="今日の送信数" value={`${view.sentToday}件`} sub={`上限 ${view.notify.dailyLimit}件`} />
        <Stat
          label="いまの時間帯"
          value={view.quiet ? "静穏時間" : "送信できます"}
          tone={view.quiet ? "warn" : "good"}
        />
        <Stat
          label="使える送信先"
          value={`${view.channels.filter((c) => c.configured).length}/3`}
          tone={view.channels.some((c) => c.configured) ? "good" : "bad"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <form action="/api/notify/settings" method="post" className="lg:col-span-2">
          <Card title="通知の条件">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                name="intervalMinutes"
                label="通知の間隔"
                value={view.notify.intervalMinutes}
                suffix="分"
                min={1}
                hint="cron をこの間隔で呼ぶ前提の値です"
              />
              <Field
                name="topN"
                label="1回に送る件数"
                value={view.notify.topN}
                suffix="件"
                min={1}
                hint="スコアの高い順に送ります"
              />
              <Field
                name="dailyLimit"
                label="1日の上限"
                value={view.notify.dailyLimit}
                suffix="件"
                min={1}
                hint="これを超えると翌日まで送りません"
              />
              <div />
              <Field
                name="quietStartHour"
                label="通知しない時間（開始）"
                value={view.notify.quietStartHour}
                suffix="時"
                min={0}
                max={23}
              />
              <Field
                name="quietEndHour"
                label="通知しない時間（終了）"
                value={view.notify.quietEndHour}
                suffix="時"
                min={0}
                max={23}
              />
            </div>

            <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-[var(--line)] p-3">
              <input
                type="checkbox"
                name="urgentEnabled"
                defaultChecked={view.notify.urgentEnabled}
                className="mt-0.5"
              />
              <span>
                <span className="text-sm font-semibold">急ぎの通知を許可する</span>
                <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                  損切りラインに触れたときなど、待てない知らせだけ静穏時間でも送ります。
                </span>
              </span>
            </label>

            <button className="btn btn-primary mt-4 w-full">保存する</button>
          </Card>
        </form>

        <div className="space-y-4">
          <Card title="送信先">
            <ul className="space-y-2">
              {view.channels.map((c) => (
                <li key={c.name} className="rounded-lg border border-[var(--line)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{c.name}</span>
                    <Badge tone={c.configured ? "good" : "bad"}>
                      {c.configured ? "設定済み" : "未設定"}
                    </Badge>
                  </div>
                  <p className="num mt-1 text-[11px] text-[var(--muted)]">{c.note}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
              送信先の鍵は .env.local に置きます（画面からは設定できません）。
              候補の通知はLINE、割引検索の結果は ChatWork / Slack / LINE から選べます。
            </p>
          </Card>

          <Card title="定期実行">
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              <span className="num">POST /api/cron/notify</span> を
              {view.notify.intervalMinutes}分おきに呼ぶと自動で送られます。
              CRON_SECRET を <span className="num">Authorization: Bearer</span> か
              <span className="num"> ?key=</span> で渡してください。
            </p>
            <Link href="/notify/queue" className="btn mt-3 w-full">
              いま送るものを確認する
            </Link>
          </Card>
        </div>
      </div>
    </StepShell>
  );
}

export default async function Page({ searchParams }: PageProps<"/notify/settings">) {
  const params = await searchParams;
  return (
    <SetupGuard>
      <NotifySettings saved={params.saved === "1"} />
    </SetupGuard>
  );
}
