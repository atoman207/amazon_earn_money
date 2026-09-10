import { NextResponse } from "next/server";
import { signUp } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** アバターは data URL で受け取る。大きすぎるものは断る。 */
const MAX_AVATAR_LENGTH = 400_000; // data URL の文字数（およそ 300KB の画像）

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  const email = str("email");
  const name = str("name");
  const phone = str("phone");
  const password = str("password");
  const passwordConfirm = str("passwordConfirm");
  const avatarUrl = str("avatarUrl");

  if (password !== passwordConfirm) {
    return NextResponse.json({ ok: false, error: "パスワードが一致しません" }, { status: 400 });
  }
  if (avatarUrl && !avatarUrl.startsWith("data:image/")) {
    return NextResponse.json({ ok: false, error: "アバターは画像を選んでください" }, { status: 400 });
  }
  if (avatarUrl.length > MAX_AVATAR_LENGTH) {
    return NextResponse.json(
      { ok: false, error: "アバターの画像が大きすぎます。別の画像を選んでください。" },
      { status: 400 },
    );
  }

  try {
    const user = await signUp({ email, name, phone, password, avatarUrl });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "登録できませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
