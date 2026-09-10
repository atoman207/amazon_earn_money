"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField } from "@/components/AuthField";
import { AvatarPicker } from "@/components/AvatarPicker";
import {
  CheckIcon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@/components/icons";
import { Card } from "@/components/ui";
import type { PublicUser } from "@/lib/supabase/database.types";

const MIN_PASSWORD_LENGTH = 8;

/** 本人の情報を書き換える。メールアドレスと権限は変えられない。 */
export function AccountForm({ user }: { user: PublicUser }) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = passwordConfirm.length > 0 && password !== passwordConfirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (password && password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl, name, phone, password, passwordConfirm }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "更新できませんでした");
      setMessage("保存しました");
      setPassword("");
      setPasswordConfirm("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
      <Card title="プロフィール">
        <div className="space-y-4">
          <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} />

          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
              <MailIcon size={15} className="text-[#1a56db]" />
              メールアドレス
            </span>
            <p className="field w-full bg-[var(--surface-2)] text-[var(--muted)]">{user.email}</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              メールアドレスと権限は変更できません。
            </p>
          </div>

          <AuthField
            id="name"
            label="名前"
            value={name}
            onChange={setName}
            icon={UserIcon}
            color="#0a7a4c"
            required
            autoComplete="name"
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
          />

          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <ShieldCheckIcon size={15} className={user.role === "admin" ? "text-[#0f766e]" : "text-[#1a56db]"} />
            権限：{user.role === "admin" ? "管理者" : "利用者"}
          </div>
        </div>
      </Card>

      <Card title="パスワードの変更">
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">
            変えないときは空のままにしてください。
          </p>
          <AuthField
            id="password"
            label="新しいパスワード"
            type="password"
            value={password}
            onChange={setPassword}
            icon={LockIcon}
            color="#c2410c"
            autoComplete="new-password"
            hint={`${MIN_PASSWORD_LENGTH}文字以上`}
          />
          <AuthField
            id="passwordConfirm"
            label="新しいパスワード（確認）"
            type="password"
            value={passwordConfirm}
            onChange={setPasswordConfirm}
            icon={ShieldCheckIcon}
            color="#7c3aed"
            autoComplete="new-password"
          />
          {passwordConfirm.length > 0 && (
            <p
              className={`flex items-center gap-1 text-[11px] ${
                mismatch ? "text-[var(--bad)]" : "text-[var(--good)]"
              }`}
            >
              <CheckIcon size={13} />
              {mismatch ? "パスワードが一致しません" : "パスワードが一致しました"}
            </p>
          )}

          {error && (
            <p className="rounded-md border border-[var(--bad)]/25 bg-[var(--bad-soft)] px-3 py-2 text-xs text-[var(--bad)]">
              {error}
            </p>
          )}
          {message && (
            <p className="flex items-center gap-1.5 rounded-md border border-[var(--good)]/25 bg-[var(--good-soft)] px-3 py-2 text-xs text-[var(--good)]">
              <CheckIcon size={14} />
              {message}
            </p>
          )}

          <button type="submit" disabled={busy || mismatch} className="btn btn-primary w-full">
            <CheckIcon size={17} />
            {busy ? "保存しています…" : "保存する"}
          </button>
        </div>
      </Card>
    </form>
  );
}
