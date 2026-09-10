/** settings テーブルに既定値を入れる（未設定のキーだけ） */
import { admin } from "./lib.mjs";

const db = admin();

const defaults = {
  costs: {
    inboundCostPerUnit: 150,
    pointsBackRate: 0.005,
    returnsRate: 0.02,
    storageFeePerDay: 8,
    fbaFeeByTier: { small: 290, standard: 434, large: 603, oversize: 1000 },
  },
  thresholds: {
    minNetProfit: 500,
    minRoi: 0.1,
    maxExpectedDays: 45,
    minConfidence: 0.6,
    stopLossRate: -0.1,
    timeStopDays: 60,
    forceSellDays: 90,
    trailingDrop: 0.12,
    storageRatioCap: 0.3,
  },
  capital: {
    workingCapital: 500000,
    kellyFraction: 0.25,
    maxPerItemRatio: 0.05,
    maxPerCategoryRatio: 0.3,
    cashReserveRatio: 0.2,
  },
  notify: {
    intervalMinutes: 60,
    topN: 5,
    dailyLimit: 30,
    quietStartHour: 1,
    quietEndHour: 7,
    urgentEnabled: true,
  },
  operation: { purchaseMode: "B", autoModeEnabled: false },
};

const { data: existing, error: readErr } = await db.from("settings").select("key");
if (readErr) {
  console.error(`settings を読めません: ${readErr.message}`);
  process.exit(1);
}
const have = new Set((existing ?? []).map((r) => r.key));

const toInsert = Object.entries(defaults)
  .filter(([k]) => !have.has(k))
  .map(([key, value]) => ({ key, value }));

if (!toInsert.length) {
  console.log("設定はすべて登録済みです:", [...have].join(", "));
  process.exit(0);
}

const { error } = await db.from("settings").insert(toInsert);
if (error) {
  console.error(`書き込みに失敗しました: ${error.message}`);
  process.exit(1);
}
console.log(`✅ 既定設定を登録しました: ${toInsert.map((t) => t.key).join(", ")}`);
