"use client";

import { useState } from "react";
import { AuthField } from "@/components/AuthField";
import { Avatar } from "@/components/Header";
import {
  CheckIcon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { Badge, Card, Empty, Stat, Td, Th } from "@/components/ui";
import type { PublicUser } from "@/lib/supabase/database.types";

const MIN_PASSWORD_LENGTH = 8;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * 管理者の画面。できるのは利用者の「追加」と「削除」だけ。
 * 既存の利用者を書き換える操作は用意しない（本人だけが変更できる）。
 */
export function UserAdmin({ me, initialUsers }: { me: PublicUser; initialUsers: PublicUser[] }) {
  const [users, setUsers] = useState<PublicUser[]>(initialUsers);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, phone, password, role }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; user?: PublicUser };
      if (!json.ok || !json.user) throw new Error(json.error ?? "追加できませんでした");
      setUsers((prev) => [...prev, json.user as PublicUser]);
      setMessage(`${json.user.email} を追加しました`);
      setEmail("");
      setName("");
      setPhone("");
      setPassword("");
      setRole("user");
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (user: PublicUser) => {
    setError(null);
    setMessage(null);
    setRemoving(user.id);
    try {
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "削除できませんでした");
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setMessage(`${user.email} を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除できませんでした");
    } finally {
      setRemoving(null);
    }
  };

  const admins = users.filter((u) => u.role === "admin").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="利用者" value={`${users.length}人`} />
        <Stat label="管理者" value={`${admins}人`} tone="good" />
        <Stat label="一般利用者" value={`${users.length - admins}人`} />
        <Stat label="あなた" value={me.name} sub={me.email} />
      </div>

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

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card title="利用者を追加">
          <form onSubmit={add} className="space-y-3.5">
            <AuthField
              id="new-email"
              label="メールアドレス"
              type="email"
              value={email}
              onChange={setEmail}
              icon={MailIcon}
              color="#1a56db"
              required
              placeholder="you@example.com"
            />
            <AuthField
              id="new-name"
              label="名前"
              value={name}
              onChange={setName}
              icon={UserIcon}
              color="#0a7a4c"
              required
              placeholder="山田 太郎"
            />
            <AuthField
              id="new-phone"
              label="電話番号"
              type="tel"
              value={phone}
              onChange={setPhone}
              icon={PhoneIcon}
              color="#0e7490"
              placeholder="090-1234-5678"
            />
            <AuthField
              id="new-password"
              label="パスワード"
              type="password"
              value={password}
              onChange={setPassword}
              icon={LockIcon}
              color="#c2410c"
              required
              hint={`${MIN_PASSWORD_LENGTH}文字以上`}
            />

            <div>
              <label
                htmlFor="new-role"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]"
              >
                <ShieldCheckIcon size={15} className="text-[#7c3aed]" />
                権限
              </label>
              <select
                id="new-role"
                className="field w-full"
                value={role}
                onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "user")}
              >
                <option value="user">利用者</option>
                <option value="admin">管理者</option>
              </select>
            </div>

            <button type="submit" disabled={busy} className="btn btn-primary w-full">
              <PlusIcon size={17} />
              {busy ? "追加しています…" : "追加する"}
            </button>
          </form>
        </Card>

        <Card
          title="利用者一覧"
          action={
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <UsersIcon size={15} className="text-[#0f766e]" />
              追加と削除のみ
            </span>
          }
        >
          {users.length === 0 ? (
            <Empty>利用者がいません。左のフォームから追加してください。</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="row-hover w-full min-w-[720px]">
                <thead>
                  <tr>
                    <Th>利用者</Th>
                    <Th>連絡先</Th>
                    <Th>権限</Th>
                    <Th right>登録日</Th>
                    <Th right> </Th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar user={u} size={34} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[var(--ink)]">
                              {u.name}
                            </div>
                            <div className="truncate text-[11px] text-[var(--muted)]">{u.email}</div>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-xs text-[var(--muted)]">{u.phone ?? "—"}</Td>
                      <Td>
                        <Badge tone={u.role === "admin" ? "good" : "default"}>
                          {u.role === "admin" ? "管理者" : "利用者"}
                        </Badge>
                      </Td>
                      <Td right className="text-xs text-[var(--muted)]">
                        {fmtTime(u.created_at)}
                      </Td>
                      <Td right>
                        <button
                          type="button"
                          onClick={() => remove(u)}
                          disabled={u.id === me.id || removing === u.id}
                          title={u.id === me.id ? "自分自身は削除できません" : "削除する"}
                          className="btn shrink-0 whitespace-nowrap px-2 py-1 text-[11px]"
                        >
                          <TrashIcon size={13} className="text-[var(--bad)]" />
                          {removing === u.id ? "削除中…" : "削除"}
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
