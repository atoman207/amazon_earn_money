import {
  AlertTriangleIcon,
  BellIcon,
  BoxIcon,
  CartIcon,
  ChartIcon,
  DatabaseIcon,
  HistoryIcon,
  SearchIcon,
} from "@/components/icons";

/**
 * 画面の骨格。図解の8工程をそのままタブにしたもの。
 *
 *   ① データ収集 → ② 商品分析 → ③ バックテスト・判定 → ④ LINE通知
 *   → ⑤ 購入承認・仕入れ → ⑥ 販売・在庫管理 → ⑦ 損切り・リスク管理 → ⑧ 結果分析・改善
 *
 * 各工程の中の項目（図解でカードに並んでいるもの）をサブタブにしている。
 * ここが唯一の定義で、左のタブ・工程内のサブタブ・見出しはすべてこれを読む。
 * URL は /<工程>/<サブタブ> の2階層で固定する。
 */

export type StepKey =
  | "collect"
  | "analysis"
  | "backtest"
  | "notify"
  | "purchase"
  | "inventory"
  | "risk"
  | "review";

export interface SubTab {
  slug: string;
  label: string;
  /** 図解に書かれている説明。画面の副題にそのまま出す。 */
  desc: string;
}

export interface Step {
  no: number;
  key: StepKey;
  /** タブの入口。既定のサブタブへ送る。 */
  href: string;
  label: string;
  /** 図解の見出し下にある一文 */
  lead: string;
  icon: typeof DatabaseIcon;
  color: string;
  soft: string;
  subs: SubTab[];
}

export const STEPS: Step[] = [
  {
    no: 1,
    key: "collect",
    href: "/collect",
    label: "データ収集",
    lead: "あらゆるデータを自動で収集",
    icon: DatabaseIcon,
    color: "#1a56db",
    soft: "#eff4ff",
    subs: [
      {
        slug: "discounts",
        label: "割引検索",
        desc: "カテゴリと割引率を選び、Amazonビジネスの割引商品を探す",
      },
      {
        slug: "keepa",
        label: "Keepa API",
        desc: "価格推移・売れ行き・在庫履歴",
      },
      { slug: "sellers", label: "セラー情報", desc: "競合数・出品者情報の取得" },
      { slug: "other", label: "その他データ", desc: "カテゴリ・レビュー・需要トレンド・季節性" },
    ],
  },
  {
    no: 2,
    key: "analysis",
    href: "/analysis",
    label: "商品分析",
    lead: "利益が見込める商品を自動で抽出",
    icon: SearchIcon,
    color: "#0a7a4c",
    soft: "#eaf7f1",
    subs: [
      { slug: "spread", label: "価格差の検出", desc: "現在価格と過去価格を比較" },
      { slug: "profit", label: "利益の自動計算", desc: "手数料・FBA費用を考慮し利益・ROIを算出" },
      { slug: "velocity", label: "売れ行き分析", desc: "販売速度・需要の傾向を確認" },
      { slug: "competition", label: "競合分析", desc: "出品者数・価格競合の状況を評価" },
      { slug: "risk", label: "リスクチェック", desc: "在庫リスク・規制・レビューの状態を確認" },
    ],
  },
  {
    no: 3,
    key: "backtest",
    href: "/backtest",
    label: "バックテスト・判定",
    lead: "過去データで有効性を検証",
    icon: HistoryIcon,
    color: "#c2410c",
    soft: "#fff1e8",
    subs: [
      {
        slug: "history",
        label: "過去データで検証",
        desc: "過去1年分のデータで利益率・勝率・平均保有日数などを算出",
      },
      { slug: "forecast", label: "価格変動の予測", desc: "過去の傾向から今後の価格推移を予測" },
      {
        slug: "rules",
        label: "購入条件の判定",
        desc: "仕入上限価格・推奨購入数量・目標販売価格・損切りライン・期待利益ROI",
      },
    ],
  },
  {
    no: 4,
    key: "notify",
    href: "/notify",
    label: "LINE通知",
    lead: "有望な仕入れ候補をすぐにお知らせ",
    icon: BellIcon,
    color: "#be123c",
    soft: "#ffeef2",
    subs: [
      {
        slug: "queue",
        label: "仕入れ候補をLINEで通知",
        desc: "商品名・ASIN・画像／現在価格・仕入上限／推奨数量／期待利益・ROI／過去価格グラフ／価格予測／リスク情報",
      },
      { slug: "history", label: "送信履歴", desc: "いつ・どこへ・何を送ったか" },
      { slug: "settings", label: "通知の設定", desc: "送信先・間隔・件数・静穏時間" },
    ],
  },
  {
    no: 5,
    key: "purchase",
    href: "/purchase",
    label: "購入承認・仕入れ",
    lead: "承認するだけで仕入れを実行",
    icon: CartIcon,
    color: "#0e7490",
    soft: "#e6f6fa",
    subs: [
      { slug: "approve", label: "あなたの承認で購入", desc: "Amazonで商品を購入（お客様のアカウント）" },
      { slug: "quantity", label: "購入数量の自動計算", desc: "資金配分の上限内で数量を決める" },
      { slug: "orders", label: "購入履歴の記録", desc: "購入履歴をシステムに記録" },
    ],
  },
  {
    no: 6,
    key: "inventory",
    href: "/inventory",
    label: "販売・在庫管理",
    lead: "最適なタイミングで販売",
    icon: BoxIcon,
    color: "#7c3aed",
    soft: "#f3edff",
    subs: [
      { slug: "monitor", label: "価格を継続監視", desc: "保有中の在庫と監視銘柄の値動きを追う" },
      { slug: "alerts", label: "目標価格に達したら販売通知", desc: "利確シグナルの一覧と売却の記録" },
      { slug: "pricing", label: "販売価格の自動提案", desc: "出口の理由から売却価格と数量を出す" },
      { slug: "aging", label: "在庫日数の管理", desc: "保有日数の分布と滞留の把握" },
      { slug: "markdown", label: "値下げ判断のサポート", desc: "段階値下げの予定表と下限価格" },
    ],
  },
  {
    no: 7,
    key: "risk",
    href: "/risk",
    label: "損切り・リスク管理",
    lead: "リスクを最小限に抑える",
    icon: AlertTriangleIcon,
    color: "#c62828",
    soft: "#fdecec",
    subs: [
      { slug: "stoploss", label: "損切りラインの通知", desc: "原価割れと損切りシグナル" },
      { slug: "longterm", label: "長期在庫の売却判断", desc: "45〜60日を超えた在庫の扱い" },
      { slug: "crash", label: "市場価格の急落を検知", desc: "相場の急落と競合の急増" },
      { slug: "exclude", label: "リスクの高い商品を事前に除外", desc: "買う前に外すための門番" },
    ],
  },
  {
    no: 8,
    key: "review",
    href: "/review",
    label: "結果分析・改善",
    lead: "運用データをもとに継続的に最適化",
    icon: ChartIcon,
    color: "#0f766e",
    soft: "#e7f6f4",
    subs: [
      { slug: "summary", label: "実績の自動集計", desc: "利益・勝率・ROIなど" },
      { slug: "factors", label: "成功・失敗の要因分析", desc: "何が効いて何で負けたか" },
      { slug: "logic", label: "ロジックの改善", desc: "実績にもとづく設定の見直し" },
      { slug: "precision", label: "より精度の高い仕入れ判断へ", desc: "判定と結果の答え合わせ" },
    ],
  },
];

const NUMERALS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"] as const;

export const stepNumeral = (no: number) => NUMERALS[no - 1] ?? String(no);

export function getStep(key: StepKey): Step {
  const step = STEPS.find((s) => s.key === key);
  if (!step) throw new Error(`未定義の工程です: ${key}`);
  return step;
}

export function getSub(key: StepKey, slug: string): SubTab {
  const step = getStep(key);
  const sub = step.subs.find((s) => s.slug === slug);
  if (!sub) throw new Error(`未定義のサブタブです: ${key}/${slug}`);
  return sub;
}

/** タブを開いたときに最初に出すサブタブ */
export const defaultSubHref = (step: Step) => `${step.href}/${step.subs[0].slug}`;
