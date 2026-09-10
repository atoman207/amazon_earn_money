"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField } from "@/components/AuthField";
import { AvatarPicker } from "@/components/AvatarPicker";
import { BrandLogo } from "@/components/BrandLogo";
import {
  CheckIcon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@/components/icons";

const MIN_PASSWORD_LENGTH = 8;

export function SignUpForm() {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = passwordConfirm.length > 0 && password !== passwordConfirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl, email, name, phone, password, passwordConfirm }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "登録できませんでした");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録できませんでした");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <BrandLogo height={44} className="mx-auto" />
        <h1 className="mt-3 text-center font-serif text-lg font-bold text-[var(--ink)]">新規登録</h1>
        <p className="mt-0.5 text-center text-xs text-[var(--muted)]">必要な項目を入力してください</p>
      </div>

      <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} />

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
        id="name"
        label="名前"
        value={name}
        onChange={setName}
        icon={UserIcon}
        color="#0a7a4c"
        required
        autoComplete="name"
        placeholder="山田 太郎"
      />
      <AuthField
        id="phone"
        label="電話番号"
        type="tel"
        value={phone}
        onChange={setPhone}
        icon={PhoneIcon}
        color="#0e7490"
        autoComplete="tel"
        placeholder="090-1234-5678"
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
        autoComplete="new-password"
        hint={`${MIN_PASSWORD_LENGTH}文字以上`}
      />
      <div>
        <AuthField
          id="passwordConfirm"
          label="パスワード（確認）"
          type="password"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          icon={ShieldCheckIcon}
          color="#7c3aed"
          required
          autoComplete="new-password"
        />
        {passwordConfirm.length > 0 && (
          <p
            className={`mt-1 flex items-center gap-1 text-[11px] ${
              mismatch ? "text-[var(--bad)]" : "text-[var(--good)]"
            }`}
          >
            <CheckIcon size={13} />
            {mismatch ? "パスワードが一致しません" : "パスワードが一致しました"}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-[var(--bad)]/25 bg-[var(--bad-soft)] px-3 py-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || mismatch} className="btn btn-primary w-full">
        <CheckIcon size={17} />
        {busy ? "登録しています…" : "登録する"}
      </button>

      <p className="text-center text-xs text-[var(--muted)]">
        すでにアカウントをお持ちの方は
        <Link href="/login" className="ml-1 font-semibold text-[var(--accent)] underline">
          ログイン
        </Link>
      </p>
    </form>
  );
}
