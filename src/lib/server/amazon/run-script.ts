import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Vercel などのサーバーレス環境か。
 *
 * ここでは scripts/ も node_modules/tsx も関数バンドルに入らず、Chromium も
 * 置かれていない。そのまま spawn すると ENOENT や MODULE_NOT_FOUND という
 * 原因の分からない失敗になるので、呼ぶ前にこの旗で止めて理由を返す。
 */
export const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY,
);

export const SERVERLESS_MESSAGE =
  "この操作は実ブラウザ（Playwright）を起動するため、Vercel 上では実行できません。" +
  "手元のPCで `npm run dev` を立ち上げ、そちらの画面から実行してください。";

function assertLocalRuntime() {
  if (isServerless) throw new Error(SERVERLESS_MESSAGE);
}

/**
 * スクリプトは tsx（素の Node）で走る。アプリ側と違って "server-only" を
 * 解決できないので、scripts/tsconfig.scan.json の paths で空モジュールへ
 * 差し替える。これを渡し忘れると起動直後に MODULE_NOT_FOUND で落ちる。
 */
function tsxCommand(scriptName: string, extraArgs: string[]) {
  const root = process.cwd();
  return [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    "--tsconfig",
    path.join(root, "scripts", "tsconfig.scan.json"),
    path.join(root, "scripts", scriptName),
    ...extraArgs,
  ];
}

export async function runAmazonScript(scriptName: string, extraArgs: string[] = []) {
  assertLocalRuntime();
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, tsxCommand(scriptName, extraArgs), {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: false,
    });

    let output = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

/**
 * スクリプトを切り離して起動し、すぐに戻る。
 * 割引スキャンのように数分かかる処理を API のリクエスト中に抱えないため。
 *
 * 出力は捨てずに読む。起動に失敗しても黙って消えないよう、
 * 異常終了したときは onFailure へ理由を渡す（呼び出し側が画面へ出す）。
 */
export function spawnAmazonScript(
  scriptName: string,
  extraArgs: string[] = [],
  onFailure?: (reason: string) => void | Promise<void>,
) {
  assertLocalRuntime();
  const child = spawn(process.execPath, tsxCommand(scriptName, extraArgs), {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  let tail = "";
  const keepTail = (chunk: Buffer | string) => {
    tail = `${tail}${chunk.toString()}`.slice(-2000);
  };
  child.stdout?.on("data", keepTail);
  child.stderr?.on("data", keepTail);
  // 親（Next）が先に落ちても子は生き続ける。パイプの後始末で例外にしない。
  child.stdout?.on("error", () => undefined);
  child.stderr?.on("error", () => undefined);

  child.on("error", (err) => {
    void onFailure?.(`スキャンを起動できませんでした: ${err.message}`);
  });
  child.on("close", (code) => {
    if (code === 0 || code === null) return;
    const detail = tail.trim().split(/\r?\n/).slice(-6).join("\n");
    void onFailure?.(`スキャンの実行プロセスが異常終了しました（終了コード ${code}）\n${detail}`);
  });

  child.unref();
  return { pid: child.pid ?? null };
}
