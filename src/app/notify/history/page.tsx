import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { dateTime, pct, yen } from "@/lib/format";
import { notifyHistory } from "@/lib/server/steps/notify";

export const dynamic = "force-dynamic";

async function History() {
  const view = await notifyHistory();

  return (
    <StepShell stepKey="notify" sub="history">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="送信の記録" value={`${view.rows.length}件`} sub="直近60件" />
        <Stat label="届いた" value={`${view.delivered}件`} tone={view.delivered > 0 ? "good" : "default"} />
        <Stat
          label="届かなかった"
          value={`${view.failed}件`}
          sub="未設定・APIエラーを含む"
          tone={view.failed > 0 ? "bad" : "good"}
        />
        <Stat
          label="今日"
          value={`${view.today}件`}
        />
      </div>

      <Card className="mt-4" title="送信履歴">
        {view.rows.length === 0 ? (
          <Empty>
            まだ送っていません。④-1の「いま送る」か、cron（/api/cron/notify）から送られるとここに残ります。
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[860px]">
              <thead>
                <tr>
                  <Th>送信</Th>
                  <Th>送信先</Th>
                  <Th>商品</Th>
                  <Th right>純利益</Th>
                  <Th right>ROI</Th>
                  <Th>結果</Th>
                  <Th>その後</Th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((n) => {
                  const op = n.opportunities;
                  return (
                    <tr key={n.id}>
                      <Td className="text-xs text-[var(--muted)]">{dateTime(n.sent_at)}</Td>
                      <Td className="text-xs uppercase">{n.channel}</Td>
                      <Td>
                        {op ? (
                          <Link
                            href={`/products/${op.asin}`}
                            className="line-clamp-1 text-xs hover:text-[var(--accent)]"
                          >
                            {op.products?.title ?? op.asin}
                          </Link>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">（候補が削除されています）</span>
                        )}
                      </Td>
                      <Td right className="text-xs">{op ? yen(Number(op.net_profit)) : "—"}</Td>
                      <Td right className="text-xs">{op ? pct(Number(op.roi)) : "—"}</Td>
                      <Td>
                        <Badge tone={n.delivered ? "good" : "bad"}>{n.delivered ? "届いた" : "未達"}</Badge>
                        {n.error && (
                          <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted)]">{n.error}</div>
                        )}
                      </Td>
                      <Td className="text-xs text-[var(--muted)]">
                        {!op
                          ? "—"
                          : op.status === "ordered"
                            ? "購入した"
                            : op.status === "skipped"
                              ? `見送り${op.skip_reason ? `（${op.skip_reason}）` : ""}`
                              : op.status === "expired"
                                ? "期限切れ"
                                : "未対応"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="日別の送信数">
        {view.byDay.length === 0 ? (
          <Empty>—</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {view.byDay.slice(0, 14).map((d) => (
              <li key={d.date} className="flex justify-between border-b border-[var(--line)]/60 py-1.5">
                <span className="num text-[var(--muted)]">{d.date}</span>
                <span className="num">{d.count}件</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StepShell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <History />
    </SetupGuard>
  );
}
