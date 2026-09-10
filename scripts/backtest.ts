import "./load-env";
import { backtestAsin, backtestWatched } from "../src/lib/server/backtest";
import { days, pct, yen } from "../src/lib/format";

/**
 * 過去の価格観測で「その条件で買っていたらどうだったか」を検証する。
 *   npm run backtest              … 監視銘柄をまとめて
 *   npm run backtest -- <ASIN>    … 1銘柄だけ詳しく
 */
async function main() {
  const asin = process.argv[2];

  if (asin) {
    const r = await backtestAsin(asin, 365);
    console.log(`${asin}  観測${r.sampleCount}件 / ${days(r.coverageDays)}`);
    if (r.closed === 0) {
      console.log("決着した取引がありません（データ不足）。");
      return;
    }
    console.log(
      `決着${r.closed}件 未決${r.open}件 勝率${pct(r.winRate ?? 0, 0)} ` +
        `平均ROI${pct(r.avgRoi ?? 0)} 平均保有${days(r.avgHoldingDays)} ` +
        `最大損失${yen(r.maxLoss ?? 0)} PF${r.profitFactor?.toFixed(2) ?? "—"}`,
    );
    console.log(`信頼できる標本か: ${r.reliable ? "はい" : "いいえ（参考値）"}`);
    for (const t of r.trades.slice(0, 10)) {
      console.log(
        `  ${t.entryAt.slice(0, 10)} → ${t.exitAt?.slice(0, 10) ?? "未決"} ` +
          `${yen(t.buyPrice)} → ${t.exitPrice === null ? "—" : yen(t.exitPrice)} ` +
          `${yen(t.netProfit)} (${t.exitReason})`,
      );
    }
    return;
  }

  const { summary, results } = await backtestWatched(100, 365);
  console.log(`監視${summary.asins}銘柄のうち ${summary.evaluated}銘柄で決着した取引がありました`);
  if (summary.totalTrades === 0) {
    console.log("決着した取引がありません。価格観測が増えると結果が出ます。");
    for (const r of results) {
      console.log(`  ${r.asin} 観測${r.sampleCount}件 / ${days(r.coverageDays)}`);
    }
    return;
  }
  console.log(
    `取引${summary.totalTrades}件 勝率${pct(summary.winRate ?? 0, 0)} ` +
      `平均ROI${pct(summary.avgRoi ?? 0)} 平均保有${days(summary.avgHoldingDays)} ` +
      `最大損失${yen(summary.maxLoss ?? 0)} PF${summary.profitFactor?.toFixed(2) ?? "—"} ` +
      `累計${yen(summary.totalProfit)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
