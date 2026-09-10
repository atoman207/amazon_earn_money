import { notFound } from "next/navigation";
import Link from "next/link";
import { SetupGuard } from "@/components/SetupGuard";
import { Shell } from "@/components/Shell";
import { PriceChart } from "@/components/PriceChart";
import { Badge, Card, Empty, Stat } from "@/components/ui";
import { dateOnly, dateTime, days, yen } from "@/lib/format";
import { getPosition, positionSnapshot, priceSeries } from "@/lib/server/queries";
import { loadSettings } from "@/lib/server/settings";
import { planResell } from "@/lib/domain/resell";
import type { ExitSignal } from "@/lib/domain/exit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ExitSignalRow } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

async function Detail({ id }: { id: string }) {
  const position = await getPosition(id);
  if (!position) notFound();

  const [snap, series, signalsRes] = await Promise.all([
    positionSnapshot(position),
    priceSeries(position.asin, 90),
    supabaseAdmin()
      .from("exit_signals")
      .select("*")
      .eq("position_id", id)
      .order("fired_at", { ascending: false })
      .limit(20),
  ]);
  const signals = signalsRes.data ?? [];

  const cost = Number(position.acquisition_cost);
  const invested = cost * position.qty;

  // 未対応のシグナルから「いくらで・何個売るか」を組み立てる
  const settings = await loadSettings();
  const openSignals = (signals as ExitSignalRow[])
    .filter((s) => !s.resolved)
    .map((s) => ({
      rule: s.rule as ExitSignal["rule"],
      kind: s.kind,
      severity: 0,
      message: s.message,
    }));
  const plan = planResell({
    acquisitionCost: cost,
    targetPrice: Number(position.target_price),
    stopPrice: Number(position.stop_price),
    currentPrice: snap.current ?? 0,
    median90: null,
    qty: position.qty,
    holdingDays: snap.heldDays,
    signals: openSignals,
    thresholds: settings.thresholds,
  });

  return (
    <Shell
      title={position.products?.title ?? position.asin}
      actions={
        <Link href="/inventory/monitor" className="text-sm text-[var(--accent)]">
          在庫一覧
        </Link>
      }
    >
      <p className="mb-4 text-xs text-[var(--muted)]">
        {position.asin}
        {position.products?.category ? ` / ${position.products.category}` : ""} —{" "}
        {dateOnly(position.opened_at)} 取得
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="数量" value={`${position.qty}個`} sub={`投下 ${yen(invested)}`} />
        <Stat label="1個あたり取得原価" value={yen(cost)} />
        <Stat label="現在価格" value={snap.current === null ? "—" : yen(snap.current)} />
        <Stat
          label="含み損益"
          value={snap.unrealized === null ? "—" : yen(snap.unrealized)}
          tone={(snap.unrealized ?? 0) > 0 ? "good" : (snap.unrealized ?? 0) < 0 ? "bad" : "default"}
        />
        <Stat label="保有日数" value={days(snap.heldDays)} />
      </div>

      {/* いくらで・何個売るかまで示す（⑦ 再販売の判断） */}
      <Card
        className="mt-4"
        title="売却の提案"
        action={
          <Badge tone={plan.urgency === "now" ? "bad" : plan.urgency === "soon" ? "warn" : "default"}>
            {plan.urgency === "now" ? "すぐ売る" : plan.urgency === "soon" ? "早めに売る" : "様子見"}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="提案価格" value={yen(plan.price)} sub="1個あたり" />
          <Stat label="提案数量" value={`${plan.qty}個`} sub={`保有 ${position.qty}個`} />
          <Stat
            label="1個あたりの差額"
            value={yen(plan.spreadPerUnit)}
            sub="取得原価との差（手数料前）"
            tone={plan.spreadPerUnit > 0 ? "good" : plan.spreadPerUnit < 0 ? "bad" : "default"}
          />
          <Stat
            label="段階値下げ"
            value={plan.stepping ? "実施中" : "なし"}
            sub={`${settings.thresholds.timeStopDays}日で開始 / ${settings.thresholds.forceSellDays}日で成行`}
            tone={plan.stepping ? "warn" : "default"}
          />
        </div>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">{plan.reason}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          提案するところまでが自動です。実際に売るかどうかは下の「売却記録」で確認して決めてください。
        </p>
      </Card>

      <Card className="mt-4" title="価格推移（90日）">
        {series.length === 0 ? (
          <Empty>価格履歴がまだありません</Empty>
        ) : (
          <PriceChart
            data={series}
            acquisitionCost={cost}
            targetPrice={Number(position.target_price)}
            stopPrice={Number(position.stop_price)}
            height={320}
          />
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="判定履歴">
          {signals.length === 0 ? (
            <Empty>まだシグナルはありません</Empty>
          ) : (
            <ul className="space-y-2">
              {signals.map((s) => (
                <li key={s.id} className="rounded-lg border border-[var(--line)] p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={s.kind === "stop_loss" ? "bad" : "good"}>
                      {s.rule} {s.kind === "stop_loss" ? "損切り" : "利確"}
                    </Badge>
                    {s.resolved && <Badge>対応済み</Badge>}
                    <span className="text-xs text-[var(--muted)]">{dateTime(s.fired_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{s.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="売却記録">
          <form action={`/api/positions/${position.id}/sell`} method="post" className="space-y-3">
            <div>
              <label className="block text-xs text-[var(--muted)]">売却価格（1個あたり）</label>
              <input
                name="sellPrice"
                type="number"
                required
                min={1}
                defaultValue={plan.price}
                className="field num mt-1"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)]">数量</label>
              <input
                name="qty"
                type="number"
                required
                min={1}
                max={position.qty}
                defaultValue={plan.qty}
                className="field num mt-1"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)]">きっかけ（任意）</label>
              <input
                name="exitRule"
                placeholder="E-1 / E-2 / X-1 など"
                className="field mt-1"
              />
            </div>
            <div>
              <label htmlFor="failureReasonCode" className="block text-xs text-[var(--muted)]">
                損になった原因（損失のときだけ記録します）
              </label>
              <select id="failureReasonCode" name="failureReasonCode" className="field mt-1">
                <option value="">選ばない</option>
                <option value="price_drop">相場が下がった</option>
                <option value="competition">競合が増えた</option>
                <option value="slow_sales">売れ行きが読みより遅かった</option>
                <option value="fee_miss">手数料の見積り違い</option>
                <option value="demand_gone">需要が消えた</option>
                <option value="other">その他</option>
              </select>
            </div>
            <div>
              <label htmlFor="note" className="block text-xs text-[var(--muted)]">
                メモ（任意）
              </label>
              <input id="note" name="note" placeholder="次回に活かすこと" className="field mt-1" />
            </div>
            <button className="btn btn-primary w-full">
              売却を記録する
            </button>
            <p className="text-xs text-[var(--muted)]">
              手数料は自動で差し引き、確定した純利益として損益画面に反映します。
            </p>
          </form>
        </Card>
      </div>
    </Shell>
  );
}

export default async function Page({ params }: PageProps<"/positions/[id]">) {
  const { id } = await params;
  return (
    <SetupGuard>
      <Detail id={id} />
    </SetupGuard>
  );
}
