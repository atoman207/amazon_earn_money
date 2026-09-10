import { NextResponse, type NextRequest } from "next/server";

/** 認証ゲートは置かない。全画面・APIをそのまま通す。 */
export function proxy(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
