import type { ReactNode } from "react";
import { checkSchema } from "@/lib/server/schema";
import { ReloadButton } from "./ReloadButton";
import { Shell } from "./Shell";
import { Card } from "./ui";

/**
 * DBの準備ができていないときに、状態を画面に出す。
 * 準備ができていれば、そのまま子要素を描画する。
 */
export async function SetupGuard({ children }: { children: ReactNode }) {
  const status = await checkSchema();
  if (status.ok) return <>{children}</>;

  const title = status.jwtClockSkew ? "接続の再試行が必要です" : "データベース未設定";

  // DBが無いとログインの確認もできないので、この画面だけは未ログインでも出す
  return (
    <Shell title={title} allowAnonymous>
      <div className="space-y-4">
        <Card title="状態">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-[var(--muted)]">接続</dt>
              <dd className={status.connected ? "text-[var(--good)]" : "text-[var(--bad)]"}>
                {status.connected ? "OK" : "失敗"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-[var(--muted)]">テーブル</dt>
              <dd className={status.missing.length ? "text-[var(--warn)]" : "text-[var(--good)]"}>
                {status.missing.length ? `${status.missing.length} 個未作成` : "作成済み"}
              </dd>
            </div>
            {status.error && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="w-28 shrink-0 text-[var(--muted)]">エラー</dt>
                <dd className="text-[var(--bad)]">{status.error}</dd>
              </div>
            )}
          </dl>
          {status.jwtClockSkew && (
            <p className="mt-3 text-sm text-[var(--muted)]">
              認証トークンの発行時刻がサーバーより先になっています。数秒待って再読み込みしてください。
            </p>
          )}
          <ReloadButton />
        </Card>
      </div>
    </Shell>
  );
}
