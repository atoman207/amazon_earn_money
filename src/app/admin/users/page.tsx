import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { currentUser, listUsers } from "@/lib/server/auth";
import { UserAdmin } from "./UserAdmin";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await currentUser();
  if (!me) redirect("/login");

  if (me.role !== "admin") {
    return (
      <Shell title="利用者管理">
        <Card title="権限がありません">
          <p className="text-sm text-[var(--muted)]">この画面は管理者だけが開けます。</p>
        </Card>
      </Shell>
    );
  }

  const users = await listUsers();

  return (
    <Shell title="利用者管理">
      <UserAdmin me={me} initialUsers={users} />
    </Shell>
  );
}
