import { NextResponse } from "next/server";
import { currentUser, updateUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AVATAR_LENGTH = 400_000;

/** 本人の情報を書き換える。対象は必ず Cookie の本人で、id は受け取らない。 */
export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me) {
    return NextResponse.json({ ok: false, error: "ログインしてください" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : undefined);

  const password = str("password");
  const passwordConfirm = str("passwordConfirm");
  if (password && password !== passwordConfirm) {
    return NextResponse.json({ ok: false, error: "パスワードが一致しません" }, { status: 400 });
  }

  const avatarUrl = str("avatarUrl");
  if (avatarUrl && avatarUrl.length > MAX_AVATAR_LENGTH) {
    return NextResponse.json(
      { ok: false, error: "アバターの画像が大きすぎます。別の画像を選んでください。" },
      { status: 400 },
    );
  }
  if (avatarUrl && avatarUrl !== "" && !avatarUrl.startsWith("data:image/")) {
    return NextResponse.json({ ok: false, error: "アバターは画像を選んでください" }, { status: 400 });
  }

  try {
    const user = await updateUser(me.id, {
      name: str("name"),
      phone: str("phone"),
      avatarUrl,
      password: password || undefined,
    });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新できませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
