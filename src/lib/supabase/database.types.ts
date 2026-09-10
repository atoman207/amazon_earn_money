/** supabase/migrations/0001_init.sql（単一スキーマ）に対応する型定義（手書き・最小限） */

export type ProductRow = {
  asin: string;
  title: string;
  brand: string | null;
  category: string;
  image_url: string | null;
  size_tier: "small" | "standard" | "large" | "oversize";
  weight_g: number | null;
  referral_fee_rate: number;
  restricted: boolean;
  restricted_reason: string | null;
  listing_gate?: "PASS" | "FAIL" | "UNKNOWN";
  created_at: string;
}

export type WatchRow = {
  asin: string;
  tier: "A" | "B" | "C";
  priority: number;
  last_checked_at: string | null;
  active: boolean;
  status?: "candidate" | "review" | "watching" | "paused" | "ended";
  reason?: string | null;
  max_buy_price?: number | null;
  review_by?: string | null;
  strategy?: string | null;
}

export type PriceObservationRow = {
  id: number;
  asin: string;
  observed_at: string;
  buy_price: number | null;
  sell_price: number | null;
  offer_count: number | null;
  sales_rank: number | null;
  in_stock: boolean;
  source: string;
}

export type PriceStatRow = {
  asin: string;
  stat_date: string;
  median_price: number | null;
  min_price: number | null;
  max_price: number | null;
  stddev_price: number | null;
  sales_per_day: number | null;
  offer_count: number | null;
}

export type SettingRow = {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

export type OpportunityRow = {
  id: string;
  asin: string;
  detected_at: string;
  buy_price: number;
  expected_sell_price: number;
  referral_fee: number;
  fba_fee: number;
  storage_fee: number;
  returns_allowance: number;
  inbound_cost: number;
  points_back: number;
  acquisition_cost: number;
  net_proceeds: number;
  net_profit: number;
  roi: number;
  sales_per_day: number;
  offer_count: number;
  expected_days: number;
  sell_probability: number;
  expected_profit: number;
  annualized_return: number;
  confidence: number;
  risk_factor: number;
  score: number;
  suggested_qty: number;
  pattern: string;
  reasons: string[];
  warnings: string[];
  passed: boolean;
  status: "pending" | "approved" | "skipped" | "expired" | "ordered";
  decided_at: string | null;
  skip_reason: string | null;
  skip_reason_code?: string | null;
  expires_at: string | null;
  max_buy_price?: number | null;
  reference_price?: number | null;
  discount_rate?: number | null;
  listing_gate?: "PASS" | "FAIL" | "UNKNOWN" | null;
  judgment?: "buy" | "pilot" | "review" | "skip" | null;
}

export type NotificationRow = {
  id: string;
  opportunity_id: string | null;
  channel: string;
  sent_at: string;
  payload: Record<string, unknown> | null;
  delivered: boolean;
  error: string | null;
}

export type OrderRow = {
  id: string;
  opportunity_id: string | null;
  asin: string;
  ordered_at: string;
  qty: number;
  unit_price: number;
  acquisition_cost: number;
  mode: "A" | "B" | "C";
  status: "placed" | "failed" | "cancelled";
  failure_reason: string | null;
  amazon_order_id?: string | null;
  actual_paid?: number | null;
}

export type PositionRow = {
  id: string;
  order_id: string | null;
  asin: string;
  opened_at: string;
  qty: number;
  acquisition_cost: number;
  target_price: number;
  stop_price: number;
  peak_price: number | null;
  status: "holding" | "listed" | "sold" | "stopped";
  closed_at: string | null;
}

export type ExitSignalRow = {
  id: string;
  position_id: string;
  rule: string;
  kind: "take_profit" | "stop_loss";
  fired_at: string;
  message: string;
  current_price: number | null;
  resolved: boolean;
}

export type SaleRow = {
  id: string;
  position_id: string;
  asin: string;
  sold_at: string;
  qty: number;
  sell_price: number;
  fees: number;
  realized_profit: number;
  holding_days: number;
  exit_rule: string | null;
  /** 損になったときの原因。次回の判断を良くするために残す。 */
  failure_reason_code?: SaleFailureCode | null;
  note?: string | null;
}

export type SaleFailureCode =
  | "price_drop"
  | "competition"
  | "slow_sales"
  | "fee_miss"
  | "demand_gone"
  | "other";

export type AiAnalysisRow = {
  id: string;
  task: string;
  target: string | null;
  model: string | null;
  output: Record<string, unknown>;
  confidence: number | null;
  created_at: string;
}

export type AuditLogRow = {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export type DiscountScanStatus = "queued" | "running" | "success" | "error" | "canceled";

export type DiscountScanRow = {
  id: string;
  status: DiscountScanStatus;
  category_ids: number[];
  category_labels: string[];
  min_discount_rate: number;
  sort_value: string;
  send_methods: string[];
  step: string | null;
  log: string[];
  message: string | null;
  product_count: number;
  notified: boolean;
  cancel_requested?: boolean;
  heartbeat_at?: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

/** 履歴一覧に出す軽い列だけ。log を含めないので取得が軽い。 */
export type DiscountScanSummary = Pick<
  DiscountScanRow,
  | "id"
  | "status"
  | "category_labels"
  | "min_discount_rate"
  | "sort_value"
  | "product_count"
  | "message"
  | "started_at"
  | "finished_at"
  | "created_at"
>;

export type DiscountProductRow = {
  id: number;
  scan_id: string;
  no: number;
  asin: string;
  name: string;
  quantity: string | null;
  reference_price: number | null;
  unit_price: number | null;
  discount_rate: number | null;
  discount_amount: number | null;
  image_url: string | null;
  product_url: string | null;
  scraped_at: string;
}

export type UserRole = "admin" | "user";

/** 利用者。password_hash は画面へ渡さない（PublicUser を使う） */
export type AppUserRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  password_hash: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

/** 画面へ渡してよい利用者情報。パスワードのハッシュを含めない。 */
export type PublicUser = Omit<AppUserRow, "password_hash">;

export type SessionRow = {
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

/**
 * カートに入れた商品。
 * discount_products はスキャンごとの作業用リスト、こちらは利用者が選んだ正式な保存先。
 */
export type CartItemRow = {
  id: number;
  user_id: string | null;
  asin: string;
  name: string;
  quantity: string | null;
  reference_price: number | null;
  unit_price: number | null;
  discount_rate: number | null;
  discount_amount: number | null;
  image_url: string | null;
  product_url: string | null;
  scan_id: string | null;
  note: string | null;
  added_at: string;
}

type Rel<Col extends string, Ref extends string, RefCol extends string> = {
  foreignKeyName: string;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: [RefCol];
};

type Table<Row, R extends readonly unknown[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: R;
};

/** 埋め込みクエリ（select("*, products(*)") など）を型解決するための外部キー定義 */
type ToProduct = [Rel<"asin", "products", "asin">];
type ToOpportunity = [Rel<"opportunity_id", "opportunities", "id">];

export interface Database {
  public: {
    Tables: {
      products: Table<ProductRow>;
      watch_universe: Table<WatchRow, ToProduct>;
      price_observations: Table<PriceObservationRow, ToProduct>;
      price_stats: Table<PriceStatRow, ToProduct>;
      settings: Table<SettingRow>;
      opportunities: Table<OpportunityRow, ToProduct>;
      notifications: Table<NotificationRow, ToOpportunity>;
      orders: Table<OrderRow, [...ToProduct, ...ToOpportunity]>;
      positions: Table<PositionRow, [...ToProduct, Rel<"order_id", "orders", "id">]>;
      exit_signals: Table<ExitSignalRow, [Rel<"position_id", "positions", "id">]>;
      sales: Table<SaleRow, [...ToProduct, Rel<"position_id", "positions", "id">]>;
      ai_analyses: Table<AiAnalysisRow>;
      audit_logs: Table<AuditLogRow>;
      discount_scans: Table<DiscountScanRow>;
      discount_products: Table<DiscountProductRow, [Rel<"scan_id", "discount_scans", "id">]>;
      cart_items: Table<CartItemRow, [Rel<"scan_id", "discount_scans", "id">]>;
      app_users: Table<AppUserRow>;
      sessions: Table<SessionRow, [Rel<"user_id", "app_users", "id">]>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export const TABLES = [
  "products",
  "watch_universe",
  "price_observations",
  "price_stats",
  "settings",
  "opportunities",
  "notifications",
  "orders",
  "positions",
  "exit_signals",
  "sales",
  "ai_analyses",
  "audit_logs",
  "discount_scans",
  "discount_products",
  "cart_items",
  "app_users",
  "sessions",
] as const;
