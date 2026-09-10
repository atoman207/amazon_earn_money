import { redirect } from "next/navigation";
import { currentUser, ensureSeedUsers } from "@/lib/server/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  // 初回アクセスでも初期アカウントで入れるようにしておく
  await ensureSeedUsers();
  if (await currentUser()) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-2)] px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
        <LoginForm />
      </div>
    </main>
  );
}
