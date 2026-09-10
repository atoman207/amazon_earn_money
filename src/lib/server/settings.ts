import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AppSettings,
  CapitalSettings,
  CostSettings,
  NotifySettings,
  OperationSettings,
  ThresholdSettings,
} from "@/lib/domain/types";

/** マイグレーションの既定値と同じもの。DBが未設定でもアプリが動くようにする。 */
export const DEFAULT_SETTINGS: AppSettings = {
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
    cashReserveRatio: 0.3,
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

/** DBの値で既定値を上書きする（欠けたキーは既定値のまま） */
export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await supabaseAdmin().from("settings").select("key, value");
  if (error || !data) return DEFAULT_SETTINGS;

  const byKey = new Map(data.map((r) => [r.key, r.value as Record<string, unknown>]));
  return {
    costs: { ...DEFAULT_SETTINGS.costs, ...(byKey.get("costs") as Partial<CostSettings>) },
    thresholds: {
      ...DEFAULT_SETTINGS.thresholds,
      ...(byKey.get("thresholds") as Partial<ThresholdSettings>),
    },
    capital: { ...DEFAULT_SETTINGS.capital, ...(byKey.get("capital") as Partial<CapitalSettings>) },
    notify: { ...DEFAULT_SETTINGS.notify, ...(byKey.get("notify") as Partial<NotifySettings>) },
    operation: {
      ...DEFAULT_SETTINGS.operation,
      ...(byKey.get("operation") as Partial<OperationSettings>),
    },
  };
}

export async function saveSetting(key: keyof AppSettings, value: unknown) {
  const { error } = await supabaseAdmin()
    .from("settings")
    .upsert({ key, value: value as Record<string, unknown>, updated_at: new Date().toISOString() });
  if (error) throw new Error(`設定の保存に失敗しました: ${error.message}`);
}

export async function audit(actor: string, action: string, target?: string | null, detail?: unknown) {
  await supabaseAdmin()
    .from("audit_logs")
    .insert({ actor, action, target: target ?? null, detail: (detail ?? null) as never });
}
