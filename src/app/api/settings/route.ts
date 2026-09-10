import { NextResponse } from "next/server";
import { audit, loadSettings, saveSetting } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

const num = (form: FormData, key: string, fallback: number) => {
  const v = Number(form.get(key));
  return Number.isFinite(v) ? v : fallback;
};

export async function POST(req: Request) {
  const form = await req.formData();
  const cur = await loadSettings();

  await saveSetting("thresholds", {
    ...cur.thresholds,
    minNetProfit: num(form, "minNetProfit", cur.thresholds.minNetProfit),
    minRoi: num(form, "minRoi", cur.thresholds.minRoi),
    maxExpectedDays: num(form, "maxExpectedDays", cur.thresholds.maxExpectedDays),
    minConfidence: num(form, "minConfidence", cur.thresholds.minConfidence),
    stopLossRate: num(form, "stopLossRate", cur.thresholds.stopLossRate),
    timeStopDays: num(form, "timeStopDays", cur.thresholds.timeStopDays),
    forceSellDays: num(form, "forceSellDays", cur.thresholds.forceSellDays),
    trailingDrop: num(form, "trailingDrop", cur.thresholds.trailingDrop),
  });

  await saveSetting("capital", {
    ...cur.capital,
    workingCapital: num(form, "workingCapital", cur.capital.workingCapital),
    cashReserveRatio: num(form, "cashReserveRatio", cur.capital.cashReserveRatio),
    maxPerItemRatio: num(form, "maxPerItemRatio", cur.capital.maxPerItemRatio),
    maxPerCategoryRatio: num(form, "maxPerCategoryRatio", cur.capital.maxPerCategoryRatio),
    kellyFraction: num(form, "kellyFraction", cur.capital.kellyFraction),
  });

  await saveSetting("costs", {
    ...cur.costs,
    inboundCostPerUnit: num(form, "inboundCostPerUnit", cur.costs.inboundCostPerUnit),
    pointsBackRate: num(form, "pointsBackRate", cur.costs.pointsBackRate),
    returnsRate: num(form, "returnsRate", cur.costs.returnsRate),
    storageFeePerDay: num(form, "storageFeePerDay", cur.costs.storageFeePerDay),
    fbaFeeByTier: {
      small: num(form, "fbaSmall", cur.costs.fbaFeeByTier.small),
      standard: num(form, "fbaStandard", cur.costs.fbaFeeByTier.standard),
      large: num(form, "fbaLarge", cur.costs.fbaFeeByTier.large),
      oversize: num(form, "fbaOversize", cur.costs.fbaFeeByTier.oversize),
    },
  });

  await saveSetting("notify", {
    ...cur.notify,
    intervalMinutes: num(form, "intervalMinutes", cur.notify.intervalMinutes),
    topN: num(form, "topN", cur.notify.topN),
    dailyLimit: num(form, "dailyLimit", cur.notify.dailyLimit),
    quietStartHour: num(form, "quietStartHour", cur.notify.quietStartHour),
    quietEndHour: num(form, "quietEndHour", cur.notify.quietEndHour),
  });

  const mode = String(form.get("purchaseMode") ?? cur.operation.purchaseMode);
  const autoEnabled = form.get("autoModeEnabled") !== null;
  await saveSetting("operation", {
    purchaseMode: (["A", "B", "C"].includes(mode) ? mode : "B") as "A" | "B" | "C",
    // 全自動はチェックが入っているときだけ有効にする
    autoModeEnabled: mode === "C" ? autoEnabled : false,
  });

  await audit("user", "update_settings");
  return NextResponse.redirect(new URL("/settings", req.url), 303);
}
