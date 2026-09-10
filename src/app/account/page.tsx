import Link from "next/link";
import { redirect } from "next/navigation";
import { BoxIcon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/server/auth";
import { AccountForm } from "./AccountForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <Shell
      title="利用者情報"
      actions={
        <Link href="/account/products" className="btn">
          <BoxIcon size={16} className="text-[#7c3aed]" />
          マイ商品
        </Link>
      }
    >
      <AccountForm user={user} />
    </Shell>
  );
}
