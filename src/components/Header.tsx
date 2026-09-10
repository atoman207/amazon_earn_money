"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BoxIcon, ChevronDownIcon, HomeIcon, LogOutIcon, ShieldCheckIcon, UserIcon } from "./icons";
import { BrandLogo } from "./BrandLogo";
import type { PublicUser } from "@/lib/supabase/database.types";

/** 名前から作る頭文字。アバター画像が無いときに使う。 */
function initials(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "?";
}

export function Avatar({ user, size = 40 }: { user: PublicUser; size?: number }) {
  if (user.avatar_url) {
    return (
      // 利用者が選んだ画像は data URL なので、next/image を通さずそのまま出す
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatar_url}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full border border-[var(--line)] object-cover"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${
        user.role === "admin" ? "bg-[#0f766e]" : "bg-[#1a56db]"
      }`}
    >
      {initials(user.name)}
    </span>
  );
}

/**
 * 上のバー。左にロゴ、右にアバターと名前。
 * アバターを押すと、利用者情報の変更と「マイ商品」への入口が開く。
 */
export function Header({ user }: { user: PublicUser | null }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // メニューの外を押したら閉じる
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setOpen(false);
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 flex h-[4.875rem] items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-[5vw]">
      <Link href="/" className="flex min-w-0 items-center">
        <BrandLogo height={52} />
      </Link>

      {user ? (
        <div className="relative flex items-center gap-2.5" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={`${user.name}のメニュー`}
            aria-expanded={open}
            aria-haspopup="menu"
            className="rounded-full transition hover:opacity-90"
          >
            <Avatar user={user} />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
          >
            <span className="hidden sm:inline">{user.name}</span>
            {user.role === "admin" && (
              <ShieldCheckIcon size={15} className="text-[#0f766e]" />
            )}
            <ChevronDownIcon size={15} className="text-[var(--muted)]" />
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+0.4rem)] w-60 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-lg"
            >
              <div className="flex items-center gap-2.5 border-b border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                <Avatar user={user} size={36} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--ink)]">{user.name}</div>
                  <div className="truncate text-[11px] text-[var(--muted)]">{user.email}</div>
                </div>
              </div>

              <Link
                href="/dashboard"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--ink-soft)] transition hover:bg-[var(--surface-2)]"
              >
                <HomeIcon size={17} className="text-[#1a56db]" />
                マイページ
              </Link>
              <Link
                href="/account"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--ink-soft)] transition hover:bg-[var(--surface-2)]"
              >
                <UserIcon size={17} className="text-[#0a7a4c]" />
                利用者情報の変更
              </Link>
              <Link
                href="/account/products"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--ink-soft)] transition hover:bg-[var(--surface-2)]"
              >
                <BoxIcon size={17} className="text-[#7c3aed]" />
                マイ商品
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={logout}
                className="flex w-full items-center gap-2.5 border-t border-[var(--line)] px-3 py-2.5 text-left text-sm text-[var(--bad)] transition hover:bg-[var(--bad-soft)]"
              >
                <LogOutIcon size={17} />
                ログアウト
              </button>
            </div>
          )}
        </div>
      ) : (
        <Link href="/login" className="btn btn-primary">
          ログイン
        </Link>
      )}
    </header>
  );
}
