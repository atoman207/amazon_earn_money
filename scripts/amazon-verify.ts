import { verifySavedSession } from "../src/lib/server/amazon/auth";

async function main() {
  const headed = process.argv.includes("--headed");
  const result = await verifySavedSession(headed ? "headed" : "headless");
  console.log(result.message);
  if (result.accountLabel) console.log(`account: ${result.accountLabel}`);
  console.log(`loggedIn: ${result.loggedIn ? "yes" : "no"}`);
  console.log(`business: ${result.isBusiness ? "yes" : "no"}`);
  console.log(`url: ${result.url}`);
  if (!result.loggedIn) process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
