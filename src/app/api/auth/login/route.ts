import { NextResponse } from "next/server";
import { login } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "メールアドレスとパスワードを入力してください" },
      { status: 400 },
    );
  }

  try {
    const user = await login(email, password);
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ログインできませんでした";
    // 認証の失敗は 401、それ以外（DB未整備など）は 500 で分ける
    const status = /違います/.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
