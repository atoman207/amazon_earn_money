import { SetupGuard } from "@/components/SetupGuard";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { loadSettings } from "@/lib/server/settings";
import { AmazonSessionPanel } from "./AmazonSessionPanel";

export const dynamic = "force-dynamic";

function Field({
  name,
  label,
  value,
  hint,
  step = "any",
  suffix,
}: {
  name: string;
  label: string;
  value: number | string;
  hint?: string;
  step?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          name={name}
          defaultValue={value}
          step={step}
          type="number"
          className="field num"
        />
        {suffix && <span className="shrink-0 text-xs text-[var(--muted)]">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

async function Settings() {
  const s = await loadSettings();

  return (
    <Shell title="設定">
      <div className="mb-4">
        <AmazonSessionPanel />
      </div>
      <form action="/api/settings" method="post" className="grid gap-4 lg:grid-cols-2">
        <Card title="通知条件">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              name="minNetProfit"
              label="最低純利益"
              value={s.thresholds.minNetProfit}
              suffix="円"
            />
            <Field
              name="minRoi"
              label="最低利益率"
              value={s.thresholds.minRoi}
              step="0.01"
              suffix="（0.10 = 10%）"
            />
            <Field
              name="maxExpectedDays"
              label="売れるまでの上限"
              value={s.thresholds.maxExpectedDays}
              suffix="日"
            />
            <Field
              name="minConfidence"
              label="データ信頼度の下限"
              value={s.thresholds.minConfidence}
              step="0.05"
              suffix="（0〜1）"
            />
          </div>
        </Card>

        <Card title="損切り基準">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              name="stopLossRate"
              label="価格損切り（原価比）"
              value={s.thresholds.stopLossRate}
              step="0.01"
              suffix="（−0.10 = −10%）"
            />
            <Field name="timeStopDays" label="値下げを始める日数" value={s.thresholds.timeStopDays} suffix="日" />
            <Field name="forceSellDays" label="成行売却する日数" value={s.thresholds.forceSellDays} suffix="日" />
            <Field
              name="trailingDrop"
              label="トレーリング利確"
              value={s.thresholds.trailingDrop}
              step="0.01"
              suffix="（最高値からの下落率）"
            />
          </div>
        </Card>

        <Card title="資金配分">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="workingCapital" label="運用資金" value={s.capital.workingCapital} suffix="円" />
            <Field
              name="cashReserveRatio"
              label="現金留保比率"
              value={s.capital.cashReserveRatio}
              step="0.05"
              suffix="（0.20 = 20%）"
            />
            <Field
              name="maxPerItemRatio"
              label="1銘柄あたり上限"
              value={s.capital.maxPerItemRatio}
              step="0.01"
              suffix="（運用資金比）"
            />
            <Field
              name="maxPerCategoryRatio"
              label="1カテゴリあたり上限"
              value={s.capital.maxPerCategoryRatio}
              step="0.05"
              suffix="（運用資金比）"
            />
            <Field
              name="kellyFraction"
              label="ケリー係数"
              value={s.capital.kellyFraction}
              step="0.05"
              suffix="（0.25 推奨）"
            />
          </div>
        </Card>

        <Card title="手数料・費用">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="inboundCostPerUnit" label="入庫費用（1個）" value={s.costs.inboundCostPerUnit} suffix="円" />
            <Field
              name="pointsBackRate"
              label="ポイント還元率"
              value={s.costs.pointsBackRate}
              step="0.001"
              suffix="（仕入価格比）"
            />
            <Field
              name="returnsRate"
              label="返品・値下げ引当"
              value={s.costs.returnsRate}
              step="0.005"
              suffix="（販売価格比）"
            />
            <Field name="storageFeePerDay" label="保管料（1日）" value={s.costs.storageFeePerDay} suffix="円" />
            <Field name="fbaSmall" label="配送代行 小型" value={s.costs.fbaFeeByTier.small} suffix="円" />
            <Field name="fbaStandard" label="配送代行 標準" value={s.costs.fbaFeeByTier.standard} suffix="円" />
            <Field name="fbaLarge" label="配送代行 大型" value={s.costs.fbaFeeByTier.large} suffix="円" />
            <Field name="fbaOversize" label="配送代行 特大" value={s.costs.fbaFeeByTier.oversize} suffix="円" />
          </div>
        </Card>

        <Card title="通知">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="intervalMinutes" label="通知の間隔" value={s.notify.intervalMinutes} suffix="分" />
            <Field name="topN" label="1回に送る件数" value={s.notify.topN} suffix="件" />
            <Field name="dailyLimit" label="1日の上限" value={s.notify.dailyLimit} suffix="件" />
            <Field name="quietStartHour" label="通知しない時間（開始）" value={s.notify.quietStartHour} suffix="時" />
            <Field name="quietEndHour" label="通知しない時間（終了）" value={s.notify.quietEndHour} suffix="時" />
          </div>
        </Card>

        <Card title="購入モード">
          <div className="space-y-2">
            {(
              [
                ["A", "A：手動", "通知リンクから手動で購入"],
                ["B", "B：承認購入", "承認後に注文処理"],
                ["C", "C：全自動", "確認なしで注文（既定無効）"],
              ] as const
            ).map(([v, label, desc]) => (
              <label
                key={v}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] p-3"
              >
                <input
                  type="radio"
                  name="purchaseMode"
                  value={v}
                  defaultChecked={s.operation.purchaseMode === v}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-[var(--muted)]">{desc}</span>
                </span>
              </label>
            ))}
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]">
              <input type="checkbox" name="autoModeEnabled" defaultChecked={s.operation.autoModeEnabled} />
              全自動モードを有効にする
            </label>
          </div>
        </Card>

        <div className="lg:col-span-2">
          <button className="btn btn-primary w-full sm:w-auto sm:px-8">保存</button>
        </div>
      </form>
    </Shell>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Settings />
    </SetupGuard>
  );
}
