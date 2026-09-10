/**
 * 価格変動の予測（③-2）。
 *
 * やっていることは「過去の並びに直線をあてて、そのまま先へ伸ばす」だけで、
 * そこへ月ごとの季節の癖（あれば）を掛け合わせている。
 *
 * 大事にしていること：
 *  - **当たると言わない**。当てはまりの良さ（R²）とばらつきの幅を必ず一緒に返し、
 *    材料が足りないときは reliable=false にして、画面側で数字を強く見せないようにする。
 *  - 予測に使うのは市場価格の実測だけ。欠測は捨て、作らない。
 *  - 幅は残差の標準偏差から出す。中心の線だけを見せると外れたときに気づけない。
 */

export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  price: number;
}

export interface ForecastPoint {
  date: string;
  /** 予測の中心 */
  expected: number;
  /** 予測の下側（80%の幅） */
  low: number;
  /** 予測の上側（80%の幅） */
  high: number;
}

export interface ForecastResult {
  /** 予測に使えた観測日数 */
  sampleCount: number;
  /** 観測が並んでいる期間（日） */
  coverageDays: number;
  /** 1日あたりの変化（円）。負なら下落傾向 */
  slopePerDay: number;
  /** 当てはまりの良さ（0〜1）。低いほど直線で説明できていない */
  r2: number;
  /** 残差の標準偏差（円） */
  sigma: number;
  /** 予測の起点にした価格 */
  lastPrice: number | null;
  /** horizonDays 先の予測 */
  points: ForecastPoint[];
  /** horizonDays 先での変化率（lastPrice 比） */
  changeRate: number | null;
  direction: "up" | "down" | "flat";
  /** 月ごとの癖を使えたか（365日ぶんの履歴が要る） */
  seasonalityApplied: boolean;
  /** 予測として見せてよいだけの材料があるか */
  reliable: boolean;
}

export interface ForecastArgs {
  history: PricePoint[];
  /** 何日先まで出すか */
  horizonDays?: number;
  /** 直線をあてる期間（日） */
  windowDays?: number;
  /** これ以上の観測日数がないと reliable にしない */
  minSamples?: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_HORIZON = 30;
const DEFAULT_WINDOW = 180;
const MIN_SAMPLES = 20;
/** 80% の幅にあたる係数（正規分布） */
const Z80 = 1.2816;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

const empty = (sampleCount: number, coverageDays: number): ForecastResult => ({
  sampleCount,
  coverageDays,
  slopePerDay: 0,
  r2: 0,
  sigma: 0,
  lastPrice: null,
  points: [],
  changeRate: null,
  direction: "flat",
  seasonalityApplied: false,
  reliable: false,
});

/**
 * 月ごとの癖（季節性）。1年ぶん以上の履歴があるときだけ出す。
 * 値は「その月の中央値 / 全体の中央値」で、1.0 が平年並み。
 */
export function monthlyIndex(history: PricePoint[]): Map<number, number> {
  const out = new Map<number, number>();
  const all = history.map((h) => h.price).filter((p) => p > 0);
  const base = median(all);
  if (!base || base <= 0) return out;

  const byMonth = new Map<number, number[]>();
  for (const h of history) {
    if (!(h.price > 0)) continue;
    const month = Number(h.date.slice(5, 7));
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(h.price);
  }

  for (const [month, prices] of byMonth) {
    // 1か月に3件も無いものは癖とは呼べない
    if (prices.length < 3) continue;
    const m = median(prices);
    if (m && m > 0) out.set(month, m / base);
  }
  return out;
}

/**
 * 過去の並びから、これから先の価格を出す。
 * 観測が少なければ数字は返すが reliable=false にする。
 */
export function forecastPrice(args: ForecastArgs): ForecastResult {
  const horizon = args.horizonDays ?? DEFAULT_HORIZON;
  const windowDays = args.windowDays ?? DEFAULT_WINDOW;
  const minSamples = args.minSamples ?? MIN_SAMPLES;

  const rows = args.history
    .filter((h) => Number.isFinite(h.price) && h.price > 0)
    .map((h) => ({ time: new Date(`${h.date}T00:00:00Z`).getTime(), price: h.price, date: h.date }))
    .filter((h) => Number.isFinite(h.time))
    .sort((a, b) => a.time - b.time);

  const coverageDays = rows.length >= 2 ? (rows[rows.length - 1].time - rows[0].time) / DAY_MS : 0;
  if (rows.length < 3) return empty(rows.length, coverageDays);

  const lastTime = rows[rows.length - 1].time;
  const fit = rows.filter((r) => r.time >= lastTime - windowDays * DAY_MS);
  if (fit.length < 3) return empty(rows.length, coverageDays);

  // 最小二乗法で直線をあてる（x は最後の観測日からの日数・負の値）
  const xs = fit.map((r) => (r.time - lastTime) / DAY_MS);
  const ys = fit.map((r) => r.price);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
    syy += (ys[i] - meanY) ** 2;
  }

  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;

  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const r2 = syy > 0 ? Math.max(0, 1 - ssr / syy) : 0;
  const sigma = Math.sqrt(ssr / Math.max(1, n - 2));

  // 季節の癖は1年ぶんの履歴があるときだけ使う
  const seasonal = coverageDays >= 365 ? monthlyIndex(rows) : new Map<number, number>();
  const seasonalityApplied = seasonal.size >= 6;

  const lastPrice = rows[rows.length - 1].price;
  const points: ForecastPoint[] = [];
  for (let d = 1; d <= horizon; d++) {
    const time = lastTime + d * DAY_MS;
    const date = iso(time);
    let expected = intercept + slope * d;
    if (seasonalityApplied) {
      const month = Number(date.slice(5, 7));
      const index = seasonal.get(month);
      if (index && index > 0) expected *= index;
    }
    expected = Math.max(1, expected);
    // 先へ行くほど不確かなので、幅は日数の平方根で広げる
    const spread = Z80 * sigma * Math.sqrt(1 + d / Math.max(1, n));
    points.push({
      date,
      expected: Math.round(expected),
      low: Math.round(Math.max(1, expected - spread)),
      high: Math.round(expected + spread),
    });
  }

  const target = points[points.length - 1]?.expected ?? null;
  const changeRate = target !== null && lastPrice > 0 ? target / lastPrice - 1 : null;
  // 幅の中に収まる程度の動きは「横ばい」と呼ぶ
  const meaningful = Math.max(sigma * 0.5, lastPrice * 0.02);
  const direction =
    target === null || Math.abs(target - lastPrice) < meaningful
      ? "flat"
      : target > lastPrice
        ? "up"
        : "down";

  return {
    sampleCount: rows.length,
    coverageDays,
    slopePerDay: slope,
    r2,
    sigma,
    lastPrice,
    points,
    changeRate,
    direction,
    seasonalityApplied,
    reliable: fit.length >= minSamples && coverageDays >= 60,
  };
}

/** 予測を1行の日本語にする。数字だけを並べても意味が伝わらないため。 */
export function describeForecast(f: ForecastResult, horizonDays = DEFAULT_HORIZON): string {
  if (!f.points.length || f.lastPrice === null) return "予測に使える価格の記録がありません。";
  const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
  const last = f.points[f.points.length - 1];
  const move =
    f.direction === "flat"
      ? "横ばい"
      : f.direction === "up"
        ? `${((f.changeRate ?? 0) * 100).toFixed(1)}% の上昇`
        : `${((f.changeRate ?? 0) * 100).toFixed(1)}% の下落`;
  const caveat = f.reliable
    ? `当てはまり R²=${f.r2.toFixed(2)}`
    : "材料が少ないため目安にとどめてください";
  return `${horizonDays}日後は ${yen(last.expected)}（${yen(last.low)}〜${yen(last.high)}）。いまの ${yen(
    f.lastPrice,
  )} から${move}の見込み。${caveat}。`;
}
