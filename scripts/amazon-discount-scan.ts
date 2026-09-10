import "./load-env";
import { runDiscountScan } from "../src/lib/server/discountScan";

/**
 * ビジネス割引スキャンを1件実行する。
 *   npm run amazon:scan -- <scanId>
 * API からは detached で起動され、進捗は discount_scans テーブルに書かれる。
 */
async function main() {
  const scanId = process.argv[2];
  if (!scanId) {
    console.error("使い方: tsx scripts/amazon-discount-scan.ts <scanId>");
    process.exitCode = 1;
    return;
  }

  const scan = await runDiscountScan(scanId);
  console.log(`status: ${scan.status}`);
  console.log(`products: ${scan.product_count}`);
  if (scan.message) console.log(scan.message);
  if (scan.status !== "success") process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
