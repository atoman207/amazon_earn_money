import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentUser, ensureSeedUsers } from "@/lib/server/auth";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/**
 * 画面の枠。上にヘッダー（ロゴ／アバター）、左にタブ、右に中身。
 *
 * すべての画面がこれを通るので、ログインの見張りもここで行う。
 * ログインしていなければ /login へ送る（/login と /signup は Shell を使わない）。
 */
export async function Shell({
  title,
  actions,
  children,
  /** DB未設定の案内など、ログイン前でも出したい画面で使う */
  allowAnonymous = false,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  allowAnonymous?: boolean;
}) {
  await ensureSeedUsers();
  const user = await currentUser();
  if (!user && !allowAnonymous) redirect("/login");

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <div className="lg:flex">
        <Sidebar user={user} />
        <div className="min-w-0 flex-1">
          <main className="px-3 py-6 sm:px-4 lg:px-5">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
              <h1 className="font-serif text-xl font-bold text-[var(--ink)] sm:text-2xl">{title}</h1>
              {actions}
            </header>
            {children}
          </main>
          <footer className="px-4 py-5 text-xs text-[var(--muted)]">
            Amazon 価格差 自動検知システム
          </footer>
        </div>
      </div>
    </div>
  );
}
