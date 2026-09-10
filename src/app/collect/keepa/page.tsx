import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Bar, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { dateTime, days, pct } from "@/lib/format";
import { keepaCollectSnapshot } from "@/lib/server/steps/collect";

export const dynamic = "force-dynamic";

async function KeepaCollect() {
  const s = await keepaCollectSnapshot();
  const maxDaily = Math.max(1, ...s.daily.map((d) => d.count));

  return (
    <StepShell
      stepKey="collect"
      sub="keepa"
      actions={
        <form action="/api/collect/run" method="post">
          <button className="btn btn-soft" disabled={!s.status.configured}>
            いま取り込む
          </button>
        </form>
      }
    >
      {!s.status.configured && (
        <div className="mb-4">
          <Callout tone="bad" title="価格を取り込めません">
            {s.status.reason}。鍵が無いあいだ、価格推移・売れ行き・在庫履歴は増えません。
            値動きが取れないと②の分析も③の検証も動かないので、ここが最優先です。
          </Callout>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Keepa"
          value={s.status.configured ? "設定済み" : "未設定"}
          sub={s.status.provides.join("・")}
          tone={s.status.configured ? "good" : "bad"}
        />
        <Stat label="監視している銘柄" value={`${s.watched}件`} sub="ここに入っているものだけ取りに行きます" />
        <Stat
          label="24時間の観測"
          value={`${s.observations.day}件`}
          sub={`7日 ${s.observations.week}件 / 30日 ${s.observations.month}件`}
          tone={s.observations.day > 0 ? "good" : "warn"}
        />
        <Stat
          label="最新が24時間以内"
          value={s.freshRatio === null ? "—" : pct(s.freshRatio, 0)}
          sub="古いほど判定の信頼度が下がります"
          tone={s.freshRatio !== null && s.freshRatio >= 0.8 ? "good" : "warn"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="直近14日の取り込み件数" className="lg:col-span-2">
          {s.observations.month === 0 ? (
            <Empty>まだ観測がありません</Empty>
          ) : (
            <ul className="space-y-1.5">
              {s.daily.map((d) => (
                <li key={d.date} className="flex items-center gap-3">
                  <span className="num w-14 shrink-0 text-[11px] text-[var(--muted)]">
                    {d.date.slice(5).replace("-", "/")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Bar value={d.count} max={maxDaily} color={d.count ? "var(--accent)" : "var(--line)"} />
                  </span>
                  <span className="num w-12 shrink-0 text-right text-[11px] text-[var(--muted)]">
                    {d.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="取り込み元">
          <ul className="space-y-2">
            {s.collectors.map((c) => (
              <li key={c.name} className="rounded-lg border border-[var(--line)] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{c.label}</span>
                  <Badge tone={c.configured ? "good" : "bad"}>{c.configured ? "設定済み" : "未設定"}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-[var(--muted)]">{c.reason ?? c.provides.join("・")}</p>
              </li>
            ))}
          </ul>
          {s.sources.length > 0 && (
            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <h3 className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">14日間の内訳</h3>
              <ul className="space-y-1 text-xs text-[var(--muted)]">
                {s.sources.map((x) => (
                  <li key={x.source} className="flex justify-between">
                    <span>{x.source}</span>
                    <span className="num">{x.count}件</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="履歴が長い銘柄（判定の信頼度が高い）">
          {s.historyDays.length === 0 ? (
            <Empty>まだ履歴がありません</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th right>履歴</Th>
                    <Th right>観測</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.historyDays.map((h) => (
                    <tr key={h.asin}>
                      <Td>
                        <Link href={`/products/${h.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {h.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{h.asin}</span>
                      </Td>
                      <Td right className="text-xs">{days(h.days)}</Td>
                      <Td right className="text-xs">{h.count}件</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="しばらく取れていない銘柄">
          {s.stale.length === 0 ? (
            <Empty>ありません。すべて3日以内に取れています。</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full">
                <thead>
                  <tr>
                    <Th>商品</Th>
                    <Th right>最終取得</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.stale.map((x) => (
                    <tr key={x.asin}>
                      <Td>
                        <Link href={`/products/${x.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                          {x.title}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">{x.asin}</span>
                      </Td>
                      <Td right className="text-xs text-[var(--muted)]">
                        {x.lastCheckedAt ? dateTime(x.lastCheckedAt) : "一度も取れていません"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="ここで取ったものが何に使われるか">
        <ul className="space-y-1.5 text-xs text-[var(--muted)]">
          <li>価格推移 → ②の価格差の検出・③の過去データ検証・③の価格変動の予測</li>
          <li>販売ランキング → ②の売れ行き分析（何日で売れるかの推定）</li>
          <li>競合出品者数 → ②の競合分析・⑦の急落検知</li>
          <li>在庫（在庫切れの記録）→ ⑤の発注直前の再確認</li>
        </ul>
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <KeepaCollect />
    </SetupGuard>
  );
}
