import fs from "node:fs";
import { admin, TABLES, migrationFiles } from "./lib.mjs";

/**
 * 後から足した列。テーブルはあっても列が無いと機能が壊れるので個別に見る。
 * 0001_init.sql は再実行しても安全なので、足りなければ全文を流し直せばよい。
 */
const REQUIRED_COLUMNS = {
  discount_scans: ["cancel_requested", "heartbeat_at"],
};

const db = admin();
const missing = [];
const missingColumns = [];
const broken = [];
const counts = {};

for (const t of TABLES) {
  const { error } = await db.from(t).select("*").limit(1);
  if (!error) {
    const { count } = await db.from(t).select("*", { count: "exact", head: true });
    counts[t] = count ?? 0;
    for (const col of REQUIRED_COLUMNS[t] ?? []) {
      const { error: colError } = await db.from(t).select(col).limit(1);
      if (colError) missingColumns.push(`${t}.${col}`);
    }
    continue;
  }
  const code = error.code ?? "";
  if (code === "PGRST205" || code === "42P01" || /does not exist|schema cache/i.test(error.message)) {
    missing.push(t);
  } else {
    broken.push(`${t}: ${error.message}`);
  }
}

console.log(`接続先: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

if (missing.length === 0 && broken.length === 0 && missingColumns.length === 0) {
  console.log(`\n✅ 接続OK。全${TABLES.length}テーブルが存在します。\n`);
  for (const t of TABLES) console.log(`   ${t.padEnd(20)} ${String(counts[t]).padStart(6)} 行`);

  const { data: settings } = await db.from("settings").select("key");
  console.log(`\n   設定キー: ${(settings ?? []).map((s) => s.key).join(", ") || "(なし)"}`);
  process.exit(0);
}

if (missingColumns.length) {
  console.error(`\n❌ 列が足りません: ${missingColumns.join(", ")}`);
  console.error(
    "\n【対処】Supabase ダッシュボード → SQL Editor に 0001_init.sql の全文を貼り付けて Run（再実行しても安全です）。",
  );
}

if (broken.length) {
  console.error("\n❌ アクセスできないテーブルがあります:");
  for (const b of broken) console.error(`   ${b}`);
}

if (missing.length) {
  console.error(`\n❌ テーブルが未作成です（${missing.length}/${TABLES.length}）: ${missing.join(", ")}`);
  console.error("\n【対処】Supabase ダッシュボード → SQL Editor を開き、次のファイル全文を貼り付けて Run:");
  for (const f of migrationFiles) {
    console.error(`   ${f}`);
    console.error(`   （${fs.statSync(f).size} バイト）`);
  }
  console.error("\n   実行後に再度  npm run db:verify  を実行してください。");
}
process.exit(1);
