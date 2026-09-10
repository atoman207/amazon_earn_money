import Link from "next/link";
import { DiscountConsole } from "./DiscountConsole";
import { SetupGuard } from "@/components/SetupGuard";
import { StepShell } from "@/components/StepShell";
import { Badge, Callout, Card, Empty, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import {
  CATEGORY_OPTIONS,
  DISCOUNT_OPTIONS,
  SEND_METHODS,
  SORT_OPTIONS,
} from "@/lib/server/amazon/catalog";
import { sessionExists } from "@/lib/server/amazon/session";
import { listScanSummaries } from "@/lib/server/discountScan";

export const dynamic = "force-dynamic";

/**
 * 割引検索（①データ収集の最初の項目）。
 *
 * 「割引率の高い商品を見つける」ところだけを単体で完結させた画面。
 */

const STATE: Record<string, { label: string; tone: "good" | "warn" | "bad" | "default" }> = {
  queued: { label: "実行待ち", tone: "warn" },
  running: { label: "実行中", tone: "warn" },
  success: { label: "完了", tone: "good" },
  canceled: { label: "中止", tone: "default" },
  error: { label: "エラー", tone: "bad" },
};

async function DiscountSearch() {
  const [sessionReady, history] = await Promise.all([sessionExists(), listScanSummaries(10)]);

  return (
    <StepShell stepKey="collect" sub="discounts">
      {!sessionReady && (
        <div className="mb-4">
          <Callout tone="warn" title="セッションが保存されていません">
            Amazonビジネスのセッションが無いと割引ページを開けません。
            <Link href="/settings" className="ml-1 underline">
              設定
            </Link>
            からログインしてください。
          </Callout>
        </div>
      )}

      <DiscountConsole
        categories={CATEGORY_OPTIONS}
        discounts={DISCOUNT_OPTIONS}
        sorts={SORT_OPTIONS}
        sendMethods={SEND_METHODS}
        sessionReady={sessionReady}
      />

      <Card className="mt-4" title="実行履歴">
        {history.length === 0 ? (
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
                {history.map((h) => {
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
                      {/* 失敗の理由は画面に出さない。詳しくは実行ログで見る。 */}
                      <Td className="text-xs text-[var(--muted)]">
                        {h.status === "error" ? "—" : (h.message ?? "—")}
                      </Td>
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
      <DiscountSearch />
    </SetupGuard>
  );
}
