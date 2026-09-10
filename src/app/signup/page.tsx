import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { SignUpForm } from "./SignUpForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (await currentUser()) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-2)] px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
        <SignUpForm />
      </div>
    </main>
  );
}
