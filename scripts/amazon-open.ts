import { openAmazonUrl } from "../src/lib/server/amazon/auth";

async function main() {
  const headed = process.argv.includes("--headed");
  const url = process.argv.filter((a) => a !== "--headed").slice(2)[0];
  if (!url) {
    console.error("使い方: npm run amazon:open -- https://www.amazon.co.jp/dp/ASIN");
    process.exitCode = 1;
    return;
  }
  const result = await openAmazonUrl(url, { mode: headed ? "headed" : "headless" });
  console.log(result.message);
  console.log(`loggedIn: ${result.auth.loggedIn ? "yes" : "no"}`);
  console.log(`business: ${result.auth.isBusiness ? "yes" : "no"}`);
  console.log(`url: ${result.auth.url}`);
  console.log(`asin: ${result.asin ?? "—"}`);
  console.log(`title: ${result.title ?? "—"}`);
  console.log(`price: ${result.price ?? "—"}`);
  if (!result.auth.loggedIn) process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
