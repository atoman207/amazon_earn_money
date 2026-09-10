import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Money, Stat, Td, Th } from "@/components/ui";
import { dateOnly, dateTime, days, pct, yen } from "@/lib/format";
import { inventoryView } from "@/lib/server/steps/inventory";

export const dynamic = "force-dynamic";

const WATCH_STATUS: Record<string, string> = {
  candidate: "候補",
  review: "要確認",
  watching: "監視中",
  paused: "休止",
  ended: "終了",
};

async function Monitor() {
  const view = await inventoryView();
  const stale = view.totals.stale;

  return (
    <StepShell
      stepKey="inventory"
      sub="monitor"
      actions={
        <form action="/api/cron/exit-scan" method="post">
          <button className="btn btn-soft">売り時を判定する</button>
        </form>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="保有中"
          value={`${view.totals.positions}件`}
          sub={`${view.totals.units}個 / 拘束 ${yen(view.totals.deployed)}`}
        />
        <Stat
          label="含み損益"
          value={yen(view.totals.unrealized)}
          tone={view.totals.unrealized > 0 ? "good" : view.totals.unrealized < 0 ? "bad" : "default"}
        />
        <Stat
          label="監視だけの銘柄"
          value={`${view.watching.length}件`}
          sub="まだ買っていないもの"
        />
        <Stat
          label="価格が古い在庫"
          value={`${stale}件`}
          sub="2日以上取れていません"
          tone={stale > 0 ? "warn" : "good"}
        />
      </div>

      <div className="mt-4">
        <Callout>
          売り時の判定は<span className="font-bold">いまの価格が取れていること</span>が前提です。
          価格が古いまま判定すると、下がっているのに気づけません。
          ①のデータ収集が動いているかを、この画面の「最終観測」で確かめてください。
        </Callout>
      </div>

      <Card className="mt-4" title="保有中の在庫">
        {view.rows.length === 0 ? (
          <Empty>
            保有中の在庫はありません。⑤で承認するとここに並びます。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[1000px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th right>数量</Th>
                  <Th right>取得原価</Th>
                  <Th right>いまの価格</Th>
                  <Th right>目標</Th>
                  <Th right>損切り</Th>
                  <Th right>含み損益</Th>
                  <Th right>保有</Th>
                  <Th>最終観測</Th>
                  <Th>状態</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => {
                  const stop = r.live.find((s) => s.kind === "stop_loss");
                  const take = r.live.find((s) => s.kind === "take_profit");
                  return (
                    <tr key={r.position.id}>
                      <Td>
                        <Link
                          href={`/positions/${r.position.id}`}
                          className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                        >
                          {r.position.products?.title ?? r.position.asin}
                        </Link>
                        <span className="num text-[11px] text-[var(--muted)]">
                          {r.position.asin} / {dateOnly(r.position.opened_at)}取得
                        </span>
                      </Td>
                      <Td right>{r.position.qty}</Td>
                      <Td right className="text-xs">{yen(r.position.acquisition_cost)}</Td>
                      <Td right className="font-semibold">
                        {r.current === null ? <span className="text-xs text-[var(--muted)]">未取得</span> : yen(r.current)}
                      </Td>
                      <Td right className="text-xs text-[var(--good)]">{yen(r.position.target_price)}</Td>
                      <Td right className="text-xs text-[var(--bad)]">{yen(r.position.stop_price)}</Td>
                      <Td right>
                        {r.unrealized === null ? (
                          "—"
                        ) : (
                          <>
                            <Money value={r.unrealized} signed />
                            {r.unrealizedRate !== null && (
                              <span className="num ml-1 text-[11px] text-[var(--muted)]">
                                {pct(r.unrealizedRate, 0)}
                              </span>
                            )}
                          </>
                        )}
                      </Td>
                      <Td right className="text-xs">{days(r.heldDays)}</Td>
                      <Td className="text-xs text-[var(--muted)]">{dateTime(r.observedAt)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {stop && <Badge tone="bad">{stop.rule}</Badge>}
                          {take && <Badge tone="good">{take.rule}</Badge>}
                          {!stop && !take && <Badge>保有中</Badge>}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="監視だけしている銘柄（まだ買っていない）">
        {view.watching.length === 0 ? (
          <Empty>ありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[820px]">
              <thead>
                <tr>
                  <Th>商品</Th>
                  <Th>状態</Th>
                  <Th right>仕入上限</Th>
                  <Th right>いまの価格</Th>
                  <Th>最終観測</Th>
                  <Th>理由</Th>
                  <Th>変更</Th>
                </tr>
              </thead>
              <tbody>
                {view.watching.map((w) => (
                  <tr key={w.watch.asin}>
                    <Td>
                      <Link href={`/products/${w.watch.asin}`} className="line-clamp-1 text-xs hover:text-[var(--accent)]">
                        {w.title}
                      </Link>
                      <span className="num text-[11px] text-[var(--muted)]">{w.watch.asin}</span>
                    </Td>
                    <Td>
                      <Badge>{WATCH_STATUS[w.watch.status ?? "watching"] ?? w.watch.status}</Badge>
                    </Td>
                    <Td right className="text-xs">
                      {w.watch.max_buy_price == null ? "—" : yen(w.watch.max_buy_price)}
                    </Td>
                    <Td right className="text-xs">{w.current === null ? "—" : yen(w.current)}</Td>
                    <Td className="text-xs text-[var(--muted)]">{dateTime(w.observedAt)}</Td>
                    <Td className="text-xs text-[var(--muted)]">{w.watch.reason ?? "—"}</Td>
                    <Td>
                      <form action="/api/watch" method="post" className="flex items-center gap-1">
                        <input type="hidden" name="asin" value={w.watch.asin} />
                        <input type="hidden" name="reason" value={w.watch.reason ?? "監視を続ける"} />
                        <select
                          name="status"
                          defaultValue={w.watch.status ?? "watching"}
                          className="field field-inline text-xs"
                        >
                          {Object.entries(WATCH_STATUS).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <button className="btn text-xs">変更</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Monitor />
    </SetupGuard>
  );
}
