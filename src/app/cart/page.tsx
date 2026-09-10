import { redirect } from "next/navigation";
import { SetupGuard } from "@/components/SetupGuard";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/server/auth";
import { listCartItems } from "@/lib/server/cart";
import { latestOpportunityByAsin } from "@/lib/server/promote";
import { CartConsole } from "./CartConsole";

export const dynamic = "force-dynamic";

async function CartPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const items = await listCartItems(user.id);
  // 「利益が出るか」をこの画面で見せるため、ASIN ごとの直近の判定を添える
  const opportunities = await latestOpportunityByAsin(items.map((i) => i.asin));

  return (
    <Shell title="カート">
      <CartConsole
        initialItems={items}
        initialJudgments={Object.fromEntries(
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
        )}
      />
    </Shell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <CartPage />
    </SetupGuard>
  );
}
