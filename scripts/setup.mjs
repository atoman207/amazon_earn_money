/** SQL 実行後の仕上げ: 検証 → 既定設定 → デモデータ */
import { spawnSync } from "node:child_process";

const step = (label, file) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(process.execPath, [`scripts/${file}`], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n✖ ${label} で止まりました。`);
    process.exit(r.status ?? 1);
  }
};

step("テーブルの確認", "verify-db.mjs");
step("既定設定の投入", "init-settings.mjs");
step("デモデータの投入", "seed.mjs");

console.log("\n✅ 準備完了。 npm run dev で起動し、ホームの「いま値引きを探す」を押してください。");
