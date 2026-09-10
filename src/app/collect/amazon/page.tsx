import Link from "next/link";
import { DiscountConsole } from "@/app/discounts/DiscountConsole";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Bar, Callout, Card, Empty, Stat, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import {
  CATEGORY_OPTIONS,
  DISCOUNT_OPTIONS,
  SEND_METHODS,
  SORT_OPTIONS,
} from "@/lib/server/amazon/catalog";
import { sessionExists } from "@/lib/server/amazon/session";
import { amazonCollectSnapshot } from "@/lib/server/steps/collect";

export const dynamic = "force-dynamic";

const STATE: Record<string, { label: string; tone: "good" | "warn" | "bad" | "default" }> = {
  queued: { label: "実行待ち", tone: "warn" },
  running: { label: "実行中", tone: "warn" },
  success: { label: "完了", tone: "good" },
  canceled: { label: "中止", tone: "default" },
  error: { label: "エラー", tone: "bad" },
};

async function AmazonCollect() {
  const [snapshot, sessionReady] = await Promise.all([amazonCollectSnapshot(), sessionExists()]);
  const { session, scan, coverage, master } = snapshot;
  const state = scan ? (STATE[scan.status] ?? { label: scan.status, tone: "default" as const }) : null;

  return (
    <StepShell stepKey="collect" sub="amazon">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Amazonビジネス"
          value={!session.exists ? "未保存" : session.loggedIn === false ? "切れています" : "ログイン済み"}
          sub={session.exists ? `保存 ${dateTime(session.savedAt)}` : "設定でログインしてください"}
          tone={session.exists && session.loggedIn !== false ? "good" : "bad"}
        />
        <Stat
          label="直近の取得件数"
          value={`${snapshot.productCount}件`}
          sub={scan ? `${state?.label} / ${dateTime(scan.finished_at ?? scan.created_at)}` : "未実行"}
          tone={snapshot.productCount > 0 ? "good" : "default"}
        />
        <Stat label="商品マスタ" value={`${master.products}件`} sub={`カテゴリ ${master.categories}種`} />
        <Stat
          label="手数料率あり"
          value={`${master.withFeeRate}件`}
          sub="販売手数料の計算に必要です"
          tone={master.products > 0 && master.withFeeRate === master.products ? "good" : "warn"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="取れている項目" className="lg:col-span-2">
          {snapshot.productCount === 0 ? (
            <Empty>まだ取得していません。下の割引検索を実行すると、ここに欠測の有無が出ます。</Empty>
          ) : (
            <ul className="space-y-3">
              {coverage.map((c) => {
                const missing = c.total - c.filled;
                return (
                  <li key={c.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-[var(--ink)]">{c.label}</span>
                      <span className="num text-xs text-[var(--muted)]">
                        {c.filled} / {c.total}
                      </span>
                    </div>
                    <Bar
                      value={c.filled}
                      max={c.total}
                      color={missing === 0 ? "var(--good)" : missing > c.total / 2 ? "var(--bad)" : "var(--warn)"}
                    />
                    {missing > 0 && (
                      <p className="mt-1 text-[11px] text-[var(--muted)]">
                        {missing}件で欠測 — {c.impact}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="この工程で集めるもの">
          <ul className="space-y-2 text-xs text-[var(--muted)]">
            <li>商品情報（商品名・ASIN・画像・カテゴリ）</li>
            <li>在庫（まとめ買いできる数量の表示）</li>
            <li>価格（ビジネス価格・参考価格・割引率）</li>
            <li>ランキング（②の売れ行き分析で使います）</li>
            <li>手数料（販売手数料率・サイズ区分。商品マスタ側で持ちます）</li>
          </ul>
          <div className="mt-3 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
            ランキングと競合数はAmazonの割引ページからは取れません。
            <Link href="/collect/keepa" className="ml-1 text-[var(--accent)] underline">
              Keepa
            </Link>
            から取り込みます。
          </div>
        </Card>
      </div>

      {!sessionReady && (
        <div className="mt-4">
          <Callout tone="warn" title="セッションが保存されていません">
            Amazonビジネスのセッションが無いと割引ページを開けません。
            <Link href="/settings" className="ml-1 underline">
              設定
            </Link>
            からログインしてください。
          </Callout>
        </div>
      )}

      <div className="mt-4">
        <DiscountConsole
          categories={CATEGORY_OPTIONS}
          discounts={DISCOUNT_OPTIONS}
          sorts={SORT_OPTIONS}
          sendMethods={SEND_METHODS}
          sessionReady={sessionReady}
        />
      </div>

      <Card className="mt-4" title="実行履歴">
        {snapshot.history.length === 0 ? (
          <Empty>まだ実行していません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="row-hover w-full min-w-[700px]">
              <thead>
                <tr>
                  <Th>実行</Th>
                  <Th>カテゴリ</Th>
                  <Th right>割引率</Th>
                  <Th right>件数</Th>
                  <Th>状態</Th>
                  <Th>結果</Th>
                </tr>
              </thead>
              <tbody>
                {snapshot.history.map((h) => {
                  const s = STATE[h.status] ?? { label: h.status, tone: "default" as const };
                  return (
                    <tr key={h.id}>
                      <Td className="text-xs text-[var(--muted)]">{dateTime(h.created_at)}</Td>
                      <Td className="text-xs">{h.category_labels.join("、") || "指定なし"}</Td>
                      <Td right className="text-xs">
                        {h.min_discount_rate}%以上
                      </Td>
                      <Td right>{h.product_count}</Td>
                      <Td>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </Td>
                      <Td className="text-xs text-[var(--muted)]">{h.message ?? "—"}</Td>
                    </tr>
                  );
                })}
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
      <AmazonCollect />
    </SetupGuard>
  );
}
