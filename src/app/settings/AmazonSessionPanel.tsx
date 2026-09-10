"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";

interface SessionStatus {
  exists: boolean;
  cookieCount: number;
  hasSessionToken: boolean;
  hasAuthToken: boolean;
  isBusinessFromFile: boolean | null;
  savedFileAt: string | null;
  savedAt: string | null;
  lastVerifiedAt: string | null;
  loggedIn: boolean | null;
  isBusiness: boolean | null;
  accountLabel: string | null;
  url: string | null;
  message: string | null;
}

type Busy = "login" | "verify" | "delete" | null;

const fmt = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function AmazonSessionPanel() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/amazon/session", { cache: "no-store" });
    const json = (await res.json()) as { ok: boolean; status?: SessionStatus; error?: string };
    if (!json.ok || !json.status) throw new Error(json.error ?? "状態を取得できませんでした");
    setStatus(json.status);
    return json.status;
  }, []);

  useEffect(() => {
    refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [refresh]);

  const run = async (action: Exclude<Busy, null>, body?: Record<string, unknown>) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/amazon/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        status?: SessionStatus;
        result?: { message?: string };
      };
      if (json.status) setStatus(json.status);
      if (!json.ok) throw new Error(json.error ?? "処理に失敗しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const loggedIn = status?.loggedIn === true;
  const expired = status?.exists && status.loggedIn === false;
  const tone = !status?.exists ? "default" : loggedIn ? "good" : expired ? "bad" : "warn";
  const label = !status
    ? "確認中"
    : !status.exists
      ? "未保存"
      : loggedIn
        ? status.isBusiness
          ? "ビジネスでログイン中"
          : "ログイン中"
        : expired
          ? "要再ログイン"
          : "保存済み（未確認）";

  return (
    <Card
      title="Amazonビジネス セッション"
      action={<Badge tone={tone}>{label}</Badge>}
    >
      <p className="text-sm text-[var(--muted)]">
        初回は画面付きブラウザが開くので、Amazonビジネスへ手動でログインしてください。完了後にセッションを保存し、次回からは仮想ブラウザがそのセッションでログイン状態を再現します。
      </p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-[var(--muted)]">アカウント</dt>
          <dd>{status?.accountLabel ?? (status?.loggedIn ? "ログイン済み" : "—")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-[var(--muted)]">ビジネス</dt>
          <dd>
            {status?.isBusiness === true || status?.isBusinessFromFile === true
              ? "はい"
              : status?.exists
                ? "未確認"
                : "—"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-[var(--muted)]">保存日時</dt>
          <dd className="num">{fmt(status?.savedAt ?? status?.savedFileAt ?? null)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-[var(--muted)]">最終確認</dt>
          <dd className="num">{fmt(status?.lastVerifiedAt ?? null)}</dd>
        </div>
      </dl>

      {status?.message && (
        <p className="mt-3 text-xs text-[var(--muted)]">{status.message}</p>
      )}
      {error && <p className="mt-3 text-sm text-[var(--bad)]">{error}</p>}
      {busy === "login" && (
        <p className="mt-3 text-sm text-[var(--accent)]">
          ブラウザが開きます。Amazonビジネスへログインしてください（最大8分）。
        </p>
      )}
      {busy === "verify" && (
        <p className="mt-3 text-sm text-[var(--accent)]">仮想ブラウザでログイン状態を確認しています…</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => run("login")}
        >
          ログインしてセッションを保存
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null || !status?.exists}
          onClick={() => run("verify")}
        >
          仮想ブラウザで確認
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null || !status?.exists}
          onClick={() => {
            if (confirm("保存済みセッションを削除しますか？")) run("delete");
          }}
        >
          セッションを削除
        </button>
      </div>

      <p className="mt-3 text-[11px] text-[var(--muted)]">
        画面が開かない場合は、サーバー側のターミナルで <code className="rounded bg-[var(--surface-2)] px-1">npm run amazon:login</code> を実行してください。
      </p>
    </Card>
  );
}
