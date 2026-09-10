"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField } from "@/components/AuthField";
import { BrandLogo } from "@/components/BrandLogo";
import { LockIcon, LogInIcon, MailIcon } from "@/components/icons";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "ログインできませんでした");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインできませんでした");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <BrandLogo height={44} className="mx-auto" />
        <p className="mt-2 text-center text-xs text-[var(--muted)]">ログインしてください</p>
      </div>

      <AuthField
        id="email"
        label="メールアドレス"
        type="email"
        value={email}
        onChange={setEmail}
        icon={MailIcon}
        color="#1a56db"
        required
        autoComplete="email"
        placeholder="you@example.com"
      />
      <AuthField
        id="password"
        label="パスワード"
        type="password"
        value={password}
        onChange={setPassword}
        icon={LockIcon}
        color="#c2410c"
        required
        autoComplete="current-password"
      />

      {error && (
        <p className="rounded-md border border-[var(--bad)]/25 bg-[var(--bad-soft)] px-3 py-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        <LogInIcon size={17} />
        {busy ? "確認しています…" : "ログイン"}
      </button>

      <p className="text-center text-xs text-[var(--muted)]">
        はじめての方は
        <Link href="/signup" className="ml-1 font-semibold text-[var(--accent)] underline">
          新規登録
        </Link>
      </p>
    </form>
  );
}
