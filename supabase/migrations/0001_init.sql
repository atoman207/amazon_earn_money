-- =====================================================================
-- Amazon 価格差 自動検知システム / スキーマ（単一ソース）
--
-- このディレクトリには本ファイルのみを置きます。
-- スキーマ変更は必ずこのファイルへ追記・反映してください（新規 SQL を作らない）。
--
-- Supabase SQL Editor にこのファイルの全文を貼り付けて実行してください。
-- 何度実行しても安全です（IF NOT EXISTS / ON CONFLICT）。
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 商品マスタ
-- ---------------------------------------------------------------------
create table if not exists products (
  asin                text primary key,
  title               text not null,
  brand               text,
  category            text not null,
  image_url           text,
  size_tier           text not null default 'standard',
  weight_g            integer,
  referral_fee_rate   numeric not null default 0.10,   -- 販売手数料率（カテゴリ別）
  restricted          boolean not null default false,  -- 出品制限・要許認可
  restricted_reason   text,
  -- 出品・証憑ゲート（PASS のみ購入可。FAIL / UNKNOWN は購入不可）
  listing_gate        text not null default 'PASS'
                      check (listing_gate in ('PASS','FAIL','UNKNOWN')),
  created_at          timestamptz not null default now()
);

-- 既存 DB（旧 0001 のみ適用済み）向けの追補
alter table products
  add column if not exists listing_gate text not null default 'PASS'
  check (listing_gate in ('PASS','FAIL','UNKNOWN'));

update products set listing_gate = 'FAIL' where restricted = true and listing_gate = 'PASS';

-- ---------------------------------------------------------------------
-- 監視ユニバース（Tier A: 重点 / B: 定期 / C: 広域）
-- ---------------------------------------------------------------------
create table if not exists watch_universe (
  asin            text primary key references products(asin) on delete cascade,
  tier            text not null default 'C' check (tier in ('A','B','C')),
  priority        numeric not null default 0,
  last_checked_at timestamptz,
  active          boolean not null default true,
  -- 監視リストのライフサイクル（R01）
  status          text not null default 'watching'
                  check (status in ('candidate','review','watching','paused','ended')),
  reason          text,
  max_buy_price   numeric,
  review_by       timestamptz,
  strategy        text default 'bottom'
);
create index if not exists watch_universe_tier_idx on watch_universe (tier, priority desc);

alter table watch_universe
  add column if not exists status text not null default 'watching'
  check (status in ('candidate','review','watching','paused','ended'));
alter table watch_universe add column if not exists reason text;
alter table watch_universe add column if not exists max_buy_price numeric;
alter table watch_universe add column if not exists review_by timestamptz;
alter table watch_universe add column if not exists strategy text default 'bottom';

-- ---------------------------------------------------------------------
-- 価格観測（追記専用 / 履歴は更新しない）
-- ---------------------------------------------------------------------
create table if not exists price_observations (
  id           bigserial primary key,
  asin         text not null references products(asin) on delete cascade,
  observed_at  timestamptz not null default now(),
  buy_price    numeric,          -- 仕入可能価格（ビジネス価格等）
  sell_price   numeric,          -- 市場価格（カート/最安値）
  offer_count  integer,
  sales_rank   integer,
  in_stock     boolean not null default true,
  source       text not null default 'sp-api'
);
create index if not exists price_obs_asin_time_idx on price_observations (asin, observed_at desc);

-- ---------------------------------------------------------------------
-- 日次統計（μ = 1日あたり推定販売数 ほか）
-- ---------------------------------------------------------------------
create table if not exists price_stats (
  asin          text not null references products(asin) on delete cascade,
  stat_date     date not null,
  median_price  numeric,
  min_price     numeric,
  max_price     numeric,
  stddev_price  numeric,
  sales_per_day numeric,
  offer_count   integer,
  primary key (asin, stat_date)
);

-- ---------------------------------------------------------------------
-- 設定（手数料・閾値・資金配分）
-- ---------------------------------------------------------------------
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 検知した機会（利益計算の全内訳を保存し、後から検証できるようにする）
-- ---------------------------------------------------------------------
create table if not exists opportunities (
  id                  uuid primary key default gen_random_uuid(),
  asin                text not null references products(asin) on delete cascade,
  detected_at         timestamptz not null default now(),

  buy_price           numeric not null,   -- Pb
  expected_sell_price numeric not null,   -- Ps

  referral_fee        numeric not null,   -- 販売手数料
  fba_fee             numeric not null,   -- 配送代行手数料
  storage_fee         numeric not null,   -- 保管料
  returns_allowance   numeric not null,   -- 返品・値下げ引当
  inbound_cost        numeric not null,   -- 入庫費用
  points_back         numeric not null,   -- ポイント還元

  acquisition_cost    numeric not null,   -- Ca 実質取得原価
  net_proceeds        numeric not null,   -- Ns 手取り額
  net_profit          numeric not null,   -- π 純利益
  roi                 numeric not null,   -- π / Ca

  sales_per_day       numeric not null,   -- μ
  offer_count         integer not null,   -- n
  expected_days       numeric not null,   -- E[h]
  sell_probability    numeric not null,   -- ps
  expected_profit     numeric not null,   -- E[π]
  annualized_return   numeric not null,   -- Rann
  confidence          numeric not null,   -- κ
  risk_factor         numeric not null,   -- φ
  score               numeric not null,   -- S

  suggested_qty       integer not null default 1,
  pattern             text not null default 'timesale',
  reasons             jsonb not null default '[]'::jsonb,
  warnings            jsonb not null default '[]'::jsonb,
  passed              boolean not null default false,
  status              text not null default 'pending'
                      check (status in ('pending','approved','skipped','expired','ordered')),
  decided_at          timestamptz,
  skip_reason         text,
  expires_at          timestamptz,

  -- 候補の仕入上限・基準価格・判定ラベル
  max_buy_price       numeric,
  reference_price     numeric,
  discount_rate       numeric,
  listing_gate        text,
  judgment            text
                      check (judgment is null or judgment in ('buy','pilot','review','skip')),
  skip_reason_code    text
);
create index if not exists opportunities_status_score_idx on opportunities (status, score desc);
create index if not exists opportunities_detected_idx on opportunities (detected_at desc);
create index if not exists opportunities_asin_idx on opportunities (asin, detected_at desc);

alter table opportunities add column if not exists max_buy_price numeric;
alter table opportunities add column if not exists reference_price numeric;
alter table opportunities add column if not exists discount_rate numeric;
alter table opportunities add column if not exists listing_gate text;
alter table opportunities add column if not exists judgment text
  check (judgment is null or judgment in ('buy','pilot','review','skip'));
alter table opportunities add column if not exists skip_reason_code text;

-- ---------------------------------------------------------------------
-- 通知履歴
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id) on delete cascade,
  channel        text not null default 'line',
  sent_at        timestamptz not null default now(),
  payload        jsonb,
  delivered      boolean not null default false,
  error          text
);
create index if not exists notifications_sent_idx on notifications (sent_at desc);

-- ---------------------------------------------------------------------
-- 発注記録
-- ---------------------------------------------------------------------
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid references opportunities(id) on delete set null,
  asin             text not null references products(asin) on delete cascade,
  ordered_at       timestamptz not null default now(),
  qty              integer not null check (qty > 0),
  unit_price       numeric not null,
  acquisition_cost numeric not null,   -- 1個あたり Ca
  mode             text not null default 'B' check (mode in ('A','B','C')),
  status           text not null default 'placed'
                   check (status in ('placed','failed','cancelled')),
  failure_reason   text,
  -- 手動仕入の証憑（注文番号・実支払額）
  amazon_order_id  text,
  actual_paid      numeric
);
create index if not exists orders_time_idx on orders (ordered_at desc);

alter table orders add column if not exists amazon_order_id text;
alter table orders add column if not exists actual_paid numeric;

-- ---------------------------------------------------------------------
-- ポジション（保有在庫）
-- ---------------------------------------------------------------------
create table if not exists positions (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid references orders(id) on delete set null,
  asin             text not null references products(asin) on delete cascade,
  opened_at        timestamptz not null default now(),
  qty              integer not null check (qty > 0),
  acquisition_cost numeric not null,   -- 1個あたり Ca
  target_price     numeric not null,   -- 目標売却価格
  stop_price       numeric not null,   -- 価格損切りライン
  peak_price       numeric,            -- 観測最高値（トレーリング用）
  status           text not null default 'holding'
                   check (status in ('holding','listed','sold','stopped')),
  closed_at        timestamptz
);
create index if not exists positions_status_idx on positions (status, opened_at);

-- ---------------------------------------------------------------------
-- 出口シグナル（E-1..E-4 利確 / X-1..X-4 損切り）
-- ---------------------------------------------------------------------
create table if not exists exit_signals (
  id            uuid primary key default gen_random_uuid(),
  position_id   uuid not null references positions(id) on delete cascade,
  rule          text not null,
  kind          text not null check (kind in ('take_profit','stop_loss')),
  fired_at      timestamptz not null default now(),
  message       text not null,
  current_price numeric,
  resolved      boolean not null default false
);
create index if not exists exit_signals_open_idx on exit_signals (resolved, fired_at desc);

-- ---------------------------------------------------------------------
-- 売却記録
-- ---------------------------------------------------------------------
create table if not exists sales (
  id              uuid primary key default gen_random_uuid(),
  position_id     uuid not null references positions(id) on delete cascade,
  asin            text not null references products(asin) on delete cascade,
  sold_at         timestamptz not null default now(),
  qty             integer not null check (qty > 0),
  sell_price      numeric not null,
  fees            numeric not null,
  realized_profit numeric not null,
  holding_days    numeric not null,
  exit_rule       text
);
create index if not exists sales_time_idx on sales (sold_at desc);

-- 失敗の原因を残す（⑧ 次回の判断を良くするための材料）
--   price_drop  相場が下がった / competition 競合が増えた
--   slow_sales  売れ行きが読みより遅かった / fee_miss 手数料の見積り違い
--   demand_gone 需要が消えた / other その他
alter table sales add column if not exists failure_reason_code text
  check (failure_reason_code is null or failure_reason_code in
    ('price_drop','competition','slow_sales','fee_miss','demand_gone','other'));
alter table sales add column if not exists note text;

-- ---------------------------------------------------------------------
-- AI分析結果
-- ---------------------------------------------------------------------
create table if not exists ai_analyses (
  id         uuid primary key default gen_random_uuid(),
  task       text not null,
  target     text,
  model      text,
  output     jsonb not null,
  confidence numeric,
  created_at timestamptz not null default now()
);
create index if not exists ai_analyses_task_idx on ai_analyses (task, created_at desc);

-- ---------------------------------------------------------------------
-- 監査ログ
-- ---------------------------------------------------------------------
create table if not exists audit_logs (
  id         bigserial primary key,
  actor      text not null,
  action     text not null,
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_time_idx on audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- ビジネス割引スキャン（カテゴリ選択 → 割引率で検索 → 商品リスト保存）
-- ---------------------------------------------------------------------
create table if not exists discount_scans (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'queued'
                    check (status in ('queued','running','success','error','canceled')),
  category_ids      integer[] not null default '{}',
  category_labels   text[]    not null default '{}',
  min_discount_rate numeric   not null,           -- 5〜30（%以上）
  sort_value        text      not null,           -- business_discount_desc など
  send_methods      text[]    not null default '{}',  -- Chatwork / Slack / LINE
  step              text,                          -- 現在の工程
  log               text[]    not null default '{}',
  message           text,
  product_count     integer   not null default 0,
  notified          boolean   not null default false,
  cancel_requested  boolean   not null default false,
  heartbeat_at      timestamptz,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists discount_scans_time_idx on discount_scans (created_at desc);
create index if not exists discount_scans_status_idx on discount_scans (status, created_at desc);

create table if not exists discount_products (
  id               bigserial primary key,
  scan_id          uuid not null references discount_scans(id) on delete cascade,
  no               integer not null,
  asin             text not null,
  name             text not null,
  quantity         text,                 -- 「20+」など表示そのまま
  reference_price  numeric,              -- 参考価格（個人向け）
  unit_price       numeric,              -- 数量別のビジネス価格
  discount_rate    numeric,              -- 割引率（%）
  discount_amount  numeric,              -- 割引額（円）
  image_url        text,
  product_url      text,
  scraped_at       timestamptz not null default now()
);
create unique index if not exists discount_products_scan_asin_idx
  on discount_products (scan_id, asin);
create index if not exists discount_products_rate_idx
  on discount_products (scan_id, discount_rate desc nulls last);

-- 中止要求と生存確認。実行プロセスが落ちても次のスキャンを始められるようにする。
alter table discount_scans add column if not exists cancel_requested boolean not null default false;
alter table discount_scans add column if not exists heartbeat_at timestamptz;
alter table discount_scans drop constraint if exists discount_scans_status_check;
alter table discount_scans add constraint discount_scans_status_check
  check (status in ('queued','running','success','error','canceled'));
create index if not exists discount_scans_heartbeat_idx
  on discount_scans (status, heartbeat_at desc nulls last);

-- ---------------------------------------------------------------------
-- 利用者とログインセッション
--
--   パスワードは平文で持たない。scrypt のハッシュ（塩＋鍵）だけを保存する。
--   セッションは推測できない乱数トークンで、Cookie 側は httpOnly にする。
--   権限は admin / user の2つだけ。admin は利用者の追加と削除のみを行う。
-- ---------------------------------------------------------------------
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  phone         text,
  avatar_url    text,                 -- data URL（小さく縮めた画像）か外部URL
  password_hash text not null,        -- scrypt: <salt(hex)>:<key(hex)>
  role          text not null default 'user' check (role in ('admin','user')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- 大文字小文字を区別せず一意にする（Admin@... と admin@... を別人にしない）
create unique index if not exists app_users_email_idx on app_users (lower(email));
create index if not exists app_users_role_idx on app_users (role, created_at);

create table if not exists sessions (
  token      text primary key,
  user_id    uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

-- ---------------------------------------------------------------------
-- カート（割引検索で見つけた中から、利用者が選んだ商品だけを残す）
--
--   discount_products … スキャンの作業用リスト（毎回まるごと入れ替わる）
--   cart_items        … 利用者が「カートに入れる」を押したものだけ。こちらが正式な保存先。
--
-- 同じ商品を二度押しても増えないよう ASIN で一意にし、押し直したら最新の価格で上書きする。
-- ---------------------------------------------------------------------
create table if not exists cart_items (
  id               bigserial primary key,
  user_id          uuid references app_users(id) on delete cascade,  -- 「マイ商品」＝その人のカート
  asin             text not null,
  name             text not null,
  quantity         text,                 -- 「20+」など表示そのまま
  reference_price  numeric,              -- 参考価格（個人向け）
  unit_price       numeric,              -- 数量別のビジネス価格
  discount_rate    numeric,              -- 割引率（%）
  discount_amount  numeric,              -- 割引額（円）
  image_url        text,
  product_url      text,
  scan_id          uuid references discount_scans(id) on delete set null,  -- どのスキャンで見つけたか
  note             text,
  added_at         timestamptz not null default now()
);
-- 同じ商品は1人につき1行。別の利用者が同じ商品を入れるのは妨げない。
alter table cart_items add column if not exists user_id uuid references app_users(id) on delete cascade;
drop index if exists cart_items_asin_idx;
create unique index if not exists cart_items_user_asin_idx on cart_items (user_id, asin);
create index if not exists cart_items_added_idx on cart_items (user_id, added_at desc);
create index if not exists cart_items_rate_idx on cart_items (user_id, discount_rate desc nulls last);

-- ---------------------------------------------------------------------
-- 行レベルセキュリティ
--   全テーブルで RLS を有効化し、ポリシーを一切作らない = 既定で全拒否。
--   publishable（anon）キーからは何も読めない。
--   アプリのサーバー側だけが secret キーで接続し、RLS をバイパスする。
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'products','watch_universe','price_observations','price_stats','settings',
    'opportunities','notifications','orders','positions','exit_signals',
    'sales','ai_analyses','audit_logs','discount_scans','discount_products','cart_items',
    'app_users','sessions'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 既定設定
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('costs', jsonb_build_object(
      'inboundCostPerUnit', 150,      -- 入庫費用（送料・資材・作業）/個
      'pointsBackRate',     0.005,    -- ポイント還元率
      'returnsRate',        0.02,     -- 返品・値下げ引当（販売価格比）
      'storageFeePerDay',   8,        -- 保管料/日（標準サイズ想定）
      'fbaFeeByTier',       jsonb_build_object(
          'small', 290, 'standard', 434, 'large', 603, 'oversize', 1000)
   )),
  ('thresholds', jsonb_build_object(
      'minNetProfit',   500,          -- 最低純利益（円）
      'minRoi',         0.10,         -- 最低利益率
      'maxExpectedDays', 45,          -- 期待保有日数の上限
      'minConfidence',  0.60,         -- データ信頼度の下限
      'stopLossRate',  -0.10,         -- 価格損切り（原価比）
      'timeStopDays',   60,           -- 時間損切り
      'forceSellDays',  90,           -- 成行売却
      'trailingDrop',   0.12,         -- トレーリング利確
      'storageRatioCap', 0.30         -- 保管費が期待利益に占める上限
   )),
  ('capital', jsonb_build_object(
      'workingCapital',    500000,    -- 運用資金
      'kellyFraction',     0.25,      -- フラクショナル・ケリー
      'maxPerItemRatio',   0.05,      -- 1銘柄あたり上限
      'maxPerCategoryRatio', 0.30,    -- 1カテゴリあたり上限
      'cashReserveRatio',  0.30       -- 現金留保比率（仕様暫定案）
   )),
  ('notify', jsonb_build_object(
      'intervalMinutes', 60,
      'topN',            5,
      'dailyLimit',      30,
      'quietStartHour',  1,
      'quietEndHour',    7,
      'urgentEnabled',   true
   )),
  ('operation', jsonb_build_object(
      'purchaseMode', 'B',            -- A: 手動 / B: 承認購入 / C: 全自動
      'autoModeEnabled', false        -- モードCは既定で無効（提案書 3.4節）
   ))
on conflict (key) do nothing;
