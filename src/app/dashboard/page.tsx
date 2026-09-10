import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BoxIcon,
  CartIcon,
  ChartIcon,
  CheckIcon,
  EyeIcon,
  ShieldCheckIcon,
  TagIcon,
  TargetIcon,
} from "@/components/icons";
import { SetupGuard } from "@/components/SetupGuard";
import { Shell } from "@/components/Shell";
import { Badge, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateTime, days, pct, yen } from "@/lib/format";
import { currentUser } from "@/lib/server/auth";
import { nextSteps, operationSnapshot } from "@/lib/server/dashboard";
import { dashboardSummary, listCandidates, listOpenSignals } from "@/lib/server/queries";
import { loadSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

const rate = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

/** スキャンの状態を、色と言葉で表す */
function scanState(status: string | undefined) {
  switch (status) {
    case "running":
    case "queued":
      return { label: status === "queued" ? "実行待ち" : "実行中", tone: "warn" as const };
    case "success":
      return { label: "完了", tone: "good" as const };
    case "canceled":
      return { label: "中止", tone: "default" as const };
    case "error":
      return { label: "エラー", tone: "bad" as const };
    default:
      return { label: "未実行", tone: "default" as const };
  }
}

async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const [summary, candidates, signals, settings, snapshot] = await Promise.all([
    dashboardSummary(),
    listCandidates(5),
    listOpenSignals(6),
    loadSettings(),
    operationSnapshot(user.id),
  ]);

  const investable = settings.capital.workingCapital * (1 - settings.capital.cashReserveRatio);
  const usage = investable > 0 ? summary.deployedCapital / investable : 0;
  const steps = nextSteps(snapshot);
  const { discount, cart, session } = snapshot;
  const state = scanState(discount.scan?.status);

  return (
    <Shell
      title="ダッシュボード"
      actions={
        <form action="/api/scan" method="post">
          <button className="btn btn-soft">スキャン実行</button>
        </form>
      }
    >
      {/* いまの状況を数字で */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="直近の割引検索"
          value={`${discount.count}件`}
          sub={
            discount.scan
              ? `${state.label} / ${dateTime(discount.scan.finished_at ?? discount.scan.created_at)}`
              : "まだ実行していません"
          }
          tone={discount.count > 0 ? "good" : "default"}
        />
        <Stat
          label="最高割引率"
          value={rate(discount.maxRate)}
          sub={`20%以上 ${discount.strongCount}件`}
          tone={discount.maxRate != null && discount.maxRate >= 20 ? "good" : "default"}
        />
        <Stat
          label="マイ商品（カート）"
          value={`${cart.count}件`}
          sub={cart.count > 0 ? `割引額の合計 ${yen(cart.totalSaving)}` : "まだ入っていません"}
        />
        <Stat
          label="対応が必要"
          value={`${summary.openSignals + summary.pendingCandidates}件`}
          sub={`候補 ${summary.pendingCandidates} / 売却シグナル ${summary.openSignals}`}
          tone={summary.openSignals > 0 ? "warn" : "default"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* いま狙える割引商品 */}
        <Card
          title="いま狙える割引商品（上位5件）"
          className="lg:col-span-2"
          action={
            <span className="flex items-center gap-2">
              <Badge tone={state.tone}>{state.label}</Badge>
              <Link href="/collect/amazon" className="text-xs text-[var(--accent)]">
                すべて見る
              </Link>
            </span>
          }
        >
          {discount.top.length === 0 ? (
            <Empty>
              まだ割引商品がありません。
              <Link href="/collect/amazon" className="ml-1 underline">
                割引検索
              </Link>
              から探してください。
            </Empty>
          ) : (
            <>
              {discount.scan && (
                <p className="mb-3 text-xs text-[var(--muted)]">
                  {discount.scan.min_discount_rate}%以上 /{" "}
                  {discount.scan.category_labels.join("、") || "カテゴリ指定なし"}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="row-hover w-full min-w-[620px]">
                  <thead>
                    <tr>
                      <Th>商品</Th>
                      <Th right>数量</Th>
                      <Th right>ビジネス価格</Th>
                      <Th right>割引率</Th>
                      <Th right>割引額</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {discount.top.map((p) => (
                      <tr key={p.id}>
                        <Td>
                          <a
                            href={p.product_url ?? `https://www.amazon.co.jp/dp/${p.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                            title={p.name}
                          >
                            {p.name}
                          </a>
                          <span className="num text-[11px] text-[var(--muted)]">{p.asin}</span>
                        </Td>
                        <Td right className="text-xs">
                          {p.quantity ?? "—"}
                        </Td>
                        <Td right className="text-xs font-semibold">
                          {yen(p.unit_price ?? 0)}
                        </Td>
                        <Td right>
                          <Badge tone="good">{rate(p.discount_rate)}</Badge>
                        </Td>
                        <Td right className="text-xs font-semibold text-[var(--good)]">
                          {yen(p.discount_amount ?? 0)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {/* 動かすための前提が整っているか */}
        <div className="space-y-4">
          <Card title="システムの状態">
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-start gap-2.5">
                <ChartIcon
                  size={17}
                  className={
                    snapshot.collectors.some((c) => c.name === "keepa" && c.configured)
                      ? "mt-0.5 text-[var(--good)]"
                      : "mt-0.5 text-[var(--bad)]"
                  }
                />
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--ink)]">価格収集</div>
                  <div className="text-xs text-[var(--muted)]">
                    {snapshot.collectors
                      .map((c) => `${c.label}：${c.configured ? "設定済み" : (c.reason ?? "未設定")}`)
                      .join(" / ")}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    24時間の観測 {snapshot.observationsToday}件
                    {snapshot.observationsToday === 0 &&
                      "（値動きが取れないと売り時の判定が動きません）"}
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheckIcon
                  size={17}
                  className={
                    session.exists && session.loggedIn !== false
                      ? "mt-0.5 text-[var(--good)]"
                      : "mt-0.5 text-[var(--warn)]"
                  }
                />
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--ink)]">Amazonビジネス</div>
                  <div className="text-xs text-[var(--muted)]">
                    {!session.exists
                      ? "セッション未保存。割引検索は動きません"
                      : session.loggedIn === false
                        ? "セッション切れ。保存し直してください"
                        : `${session.accountLabel ?? "ログイン済み"} / 保存 ${dateTime(session.savedAt)}`}
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <TagIcon size={17} className="mt-0.5 text-[#c2410c]" />
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--ink)]">割引検索</div>
                  <div className="text-xs text-[var(--muted)]">
                    {discount.scan
                      ? `${state.label}：${discount.scan.message ?? `${discount.count}件`}`
                      : "未実行"}
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <CartIcon size={17} className="mt-0.5 text-[#7c3aed]" />
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--ink)]">マイ商品</div>
                  <div className="text-xs text-[var(--muted)]">
                    {cart.count > 0
                      ? `${cart.count}件 / 最高 ${rate(cart.maxRate)} / 最終追加 ${dateTime(cart.latestAddedAt)}`
                      : "まだ入っていません"}
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <EyeIcon size={17} className="mt-0.5 text-[#0e7490]" />
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--ink)]">監視</div>
                  <div className="text-xs text-[var(--muted)]">{snapshot.watchCount}銘柄</div>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <BoxIcon size={17} className="mt-0.5 text-[#a16207]" />
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--ink)]">在庫</div>
                  <div className="text-xs text-[var(--muted)]">
                    {summary.openPositions}件 / {summary.openUnits}個 / 拘束{" "}
                    {yen(summary.deployedCapital)}
                  </div>
                </div>
              </li>
            </ul>
          </Card>

          <Card title="次にやること">
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={step.href + step.label} className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      step.done
                        ? "bg-[var(--good-soft)] text-[var(--good)]"
                        : "bg-[var(--accent-soft)] text-[var(--accent)]"
                    }`}
                  >
                    {step.done ? <CheckIcon size={12} /> : i + 1}
                  </span>
                  <Link
                    href={step.href}
                    className={`text-sm hover:underline ${
                      step.done ? "text-[var(--muted)] line-through" : "text-[var(--ink)]"
                    }`}
                  >
                    {step.label}
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {/* 仕入・在庫まわり */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card
          title="候補（上位5件）"
          className="lg:col-span-2"
          action={
            <Link href="/purchase/approve" className="text-xs text-[var(--accent)]">
              すべて見る
            </Link>
          }
        >
          {candidates.length === 0 ? (
            <Empty>
              候補はありません。価格を取り込むとここに採算の合うものが出ます。
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[640px]">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th right>純利益</Th>
                    <Th right>利益率</Th>
                    <Th right>売れるまで</Th>
                    <Th right>検知</Th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        <Link href={`/purchase/approve#${c.id}`} className="hover:text-[var(--accent)]">
                          {c.products?.title ?? c.asin}
                        </Link>
                        <div className="mt-0.5 text-xs text-[var(--muted)]">
                          {yen(c.buy_price)} → {yen(c.expected_sell_price)}
                        </div>
                      </Td>
                      <Td right>
                        <Money value={Number(c.net_profit)} />
                      </Td>
                      <Td right>{pct(Number(c.roi))}</Td>
                      <Td right>{days(Number(c.expected_days))}</Td>
                      <Td right className="text-xs text-[var(--muted)]">
                        {dateTime(c.detected_at)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="売却・損切りシグナル">
            {signals.length === 0 ? (
              <Empty>対応が必要な在庫はありません</Empty>
            ) : (
              <ul className="space-y-2">
                {signals.map((s) => (
                  <li key={s.id} className="rounded-lg border border-[var(--line)] p-2.5">
                    <div className="flex items-center gap-2">
                      <Badge tone={s.kind === "stop_loss" ? "bad" : "good"}>
                        {s.rule} {s.kind === "stop_loss" ? "損切り" : "利確"}
                      </Badge>
                      <span className="text-xs text-[var(--muted)]">{dateTime(s.fired_at)}</span>
                    </div>
                    <Link
                      href={`/positions/${s.position_id}`}
                      className="mt-1 block text-sm hover:text-[var(--accent)]"
                    >
                      {s.positions?.products?.title ?? s.positions?.asin}
                    </Link>
                    <p className="mt-1 text-xs text-[var(--muted)]">{s.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="資金と成績">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-[var(--muted)]">今日の確定利益</div>
                <div
                  className={`num text-lg font-bold ${
                    summary.todayRealized > 0
                      ? "text-[var(--good)]"
                      : summary.todayRealized < 0
                        ? "text-[var(--bad)]"
                        : "text-[var(--ink)]"
                  }`}
                >
                  {yen(summary.todayRealized)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--muted)]">今月の確定利益</div>
                <div className="num text-lg font-bold text-[var(--ink)]">
                  {yen(summary.monthRealized)}
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs text-[var(--muted)]">
              運用資金 {yen(settings.capital.workingCapital)} / 現金留保{" "}
              {pct(settings.capital.cashReserveRatio, 0)} / 投下可能 {yen(investable)}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-[var(--surface-2)]">
              <div
                className="h-full bg-[var(--accent)]"
                style={{ width: `${Math.min(100, usage * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="num mt-2 flex justify-between text-xs">
              <span className="text-[var(--muted)]">使用中 {yen(summary.deployedCapital)}</span>
              <span className="text-[var(--muted)]">
                残り {yen(Math.max(0, investable - summary.deployedCapital))}
              </span>
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">累計の確定利益</dt>
                <dd className="num">{yen(summary.allTimeRealized)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">勝率（売却済）</dt>
                <dd className="num">{summary.winRate === null ? "—" : pct(summary.winRate, 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">平均保有日数</dt>
                <dd className="num">{days(summary.avgHoldingDays)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">購入モード</dt>
                <dd>
                  {settings.operation.purchaseMode === "A"
                    ? "A：手動"
                    : settings.operation.purchaseMode === "B"
                      ? "B：承認購入"
                      : "C：全自動"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/collect/amazon" className="btn">
          <TagIcon size={16} className="text-[#c2410c]" />
          割引検索へ
        </Link>
        <Link href="/purchase/approve" className="btn">
          <TargetIcon size={16} className="text-[#0a7a4c]" />
          候補を見る
        </Link>
        <Link href="/review/summary" className="btn">
          <ChartIcon size={16} className="text-[#be123c]" />
          損益を見る
        </Link>
      </div>
    </Shell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Dashboard />
    </SetupGuard>
  );
}
