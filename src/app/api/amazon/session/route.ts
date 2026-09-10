import { NextResponse } from "next/server";
import { runAmazonScript } from "@/lib/server/amazon/run-script";
import { deleteSessionFiles, getSessionStatus } from "@/lib/server/amazon/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

function fail(message: string, status = 500, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function GET() {
  const status = await getSessionStatus();
  return NextResponse.json({ ok: true, status });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; headed?: boolean };
  const action = body.action ?? "";

  try {
    if (action === "delete") {
      await deleteSessionFiles();
      const status = await getSessionStatus();
      return NextResponse.json({ ok: true, status });
    }

    if (action === "login" || action === "verify") {
      const script = action === "login" ? "amazon-login.ts" : "amazon-verify.ts";
      const args = action === "verify" && body.headed ? ["--headed"] : [];
      const ran = await runAmazonScript(script, args);
      const status = await getSessionStatus();
      if (ran.code !== 0) {
        return fail(
          status.message ??
            (action === "login"
              ? "ログインとセッション保存に失敗しました。"
              : "仮想ブラウザでのログイン確認に失敗しました。"),
          ran.code === 2 ? 409 : 500,
          { status, output: ran.output.slice(-2000) },
        );
      }
      return NextResponse.json({ ok: true, status });
    }

    return fail("不明な操作です", 400);
  } catch (err) {
    const status = await getSessionStatus();
    const message = err instanceof Error ? err.message : "処理に失敗しました";
    return fail(message, 500, { status });
  }
}
