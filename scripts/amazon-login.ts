import { loginAndSaveSession } from "../src/lib/server/amazon/auth";

async function main() {
  const result = await loginAndSaveSession();
  console.log(result.message);
  if (result.accountLabel) console.log(`account: ${result.accountLabel}`);
  console.log(`business: ${result.isBusiness ? "yes" : "no"}`);
  console.log(`url: ${result.url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
