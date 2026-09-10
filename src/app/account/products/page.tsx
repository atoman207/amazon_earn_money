import Link from "next/link";
import { redirect } from "next/navigation";
import { CartConsole } from "@/app/cart/CartConsole";
import { UserIcon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/server/auth";
import { listCartItems } from "@/lib/server/cart";
import { latestOpportunityByAsin } from "@/lib/server/promote";

export const dynamic = "force-dynamic";

/**
 * マイ商品＝その利用者がカートに入れた商品。
 * カート画面と同じ中身を、アバターのメニューからも開けるようにしたもの。
 */
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const items = await listCartItems(user.id);
  const opportunities = await latestOpportunityByAsin(items.map((i) => i.asin));
  const judgments = Object.fromEntries(
    [...opportunities].map(([asin, op]) => [
      asin,
      {
        judgment: op.judgment ?? null,
        netProfit: Number(op.net_profit),
        roi: Number(op.roi),
        maxBuyPrice: op.max_buy_price == null ? null : Number(op.max_buy_price),
        listingGate: op.listing_gate ?? null,
        passed: op.passed,
        confidence: Number(op.confidence),
        expectedDays: Number(op.expected_days),
        warnings: op.warnings ?? [],
      },
    ]),
  );

  return (
    <Shell
      title={`${user.name} さんのマイ商品`}
      actions={
        <Link href="/account" className="btn">
          <UserIcon size={16} className="text-[#1a56db]" />
          利用者情報の変更
        </Link>
      }
    >
      <CartConsole initialItems={items} initialJudgments={judgments} />
    </Shell>
  );
}
