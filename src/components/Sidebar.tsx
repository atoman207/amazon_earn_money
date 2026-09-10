"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, SettingsIcon, UsersIcon } from "./icons";
import { defaultSubHref, stepNumeral, STEPS } from "@/lib/steps";
import type { PublicUser } from "@/lib/supabase/database.types";

/**
 * 左のタブ。図解の8工程をそのまま上から順に並べる。
 *
 * 番号を消さずに出しているのは、①→②→…→⑧ の順に流れる仕組みだからで、
 * 「いま自分がどの工程にいるか」を番号で覚えられるようにしている。
 * 工程ごとの色も図解に合わせ、画面の中身と左のタブが同じ色で結びつくようにした。
 */

export function Sidebar({ user }: { user: PublicUser | null }) {
  const path = usePathname();
  // 未ログインではタブを出さない（トップページは紹介だけを見せる）
  if (!user) return null;

  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  const linkClass = (on: boolean) =>
    `flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
      on
        ? "font-semibold"
        : "font-medium text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    }`;

  return (
    <nav
      aria-label="メインメニュー"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface)] p-2 lg:h-[calc(100vh-4.875rem)] lg:w-60 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-3"
    >
      <Link
        href="/dashboard"
        aria-current={active("/dashboard") ? "page" : undefined}
        style={active("/dashboard") ? { backgroundColor: "#eff4ff", color: "#1a56db" } : undefined}
        className={linkClass(active("/dashboard"))}
      >
        <HomeIcon size={17} style={{ color: "#1a56db" }} />
        <span className="whitespace-nowrap">ダッシュボード</span>
      </Link>

      <span className="mt-2 hidden px-3 pb-1 text-[11px] font-semibold tracking-wide text-[var(--muted)] lg:block">
        仕入れから改善までの8工程
      </span>

      {STEPS.map((step) => {
        const on = active(step.href);
        const Icon = step.icon;
        return (
          <Link
            key={step.key}
            href={defaultSubHref(step)}
            aria-current={on ? "page" : undefined}
            style={on ? { backgroundColor: step.soft, color: step.color } : undefined}
            className={linkClass(on)}
          >
            <Icon size={17} style={{ color: step.color }} />
            <span className="whitespace-nowrap">
              <span className="num mr-1 text-xs">{stepNumeral(step.no)}</span>
              {step.label}
            </span>
          </Link>
        );
      })}

      <span className="mt-2 hidden border-t border-[var(--line)] pt-2 lg:block" />

      {user.role === "admin" && (
        <Link
          href="/admin/users"
          aria-current={active("/admin/users") ? "page" : undefined}
          style={active("/admin/users") ? { backgroundColor: "#e7f6f4", color: "#0f766e" } : undefined}
          className={linkClass(active("/admin/users"))}
        >
          <UsersIcon size={17} style={{ color: "#0f766e" }} />
          <span className="whitespace-nowrap">利用者管理</span>
        </Link>
      )}

      <Link
        href="/settings"
        aria-current={active("/settings") ? "page" : undefined}
        style={active("/settings") ? { backgroundColor: "#f2f2f2", color: "#525252" } : undefined}
        className={linkClass(active("/settings"))}
      >
        <SettingsIcon size={17} style={{ color: "#525252" }} />
        <span className="whitespace-nowrap">設定</span>
      </Link>
    </nav>
  );
}
