import { NextResponse } from "next/server";
import { createUser, currentUser, deleteUser, listUsers } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 管理者ができるのは、利用者の「追加」と「削除」だけ。
 * 既存の利用者を書き換える口はここに用意しない。
 */
async function requireAdmin() {
  const me = await currentUser();
  if (!me) return { error: "ログインしてください", status: 401 as const, me: null };
  if (me.role !== "admin") return { error: "管理者だけが操作できます", status: 403 as const, me: null };
  return { error: null, status: 200 as const, me };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  return NextResponse.json({ ok: true, users: await listUsers() });
}

/** 利用者を追加する */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  const role = str("role") === "admin" ? "admin" : "user";

  try {
    const user = await createUser({
      email: str("email"),
      name: str("name"),
      phone: str("phone"),
      password: str("password"),
      role,
    });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "追加できませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/** 利用者を削除する。自分自身は消せない（管理者が居なくなるのを防ぐ）。 */
export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if (guard.error || !guard.me) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "対象を特定できませんでした" }, { status: 400 });
  }
  if (id === guard.me.id) {
    return NextResponse.json(
      { ok: false, error: "自分自身は削除できません" },
      { status: 400 },
    );
  }

  try {
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "削除できませんでした";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
