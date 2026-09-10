import { NextResponse } from "next/server";
import { getSessionStatus } from "@/lib/server/amazon/session";
import { checkSchema } from "@/lib/server/schema";

export const dynamic = "force-dynamic";

/** 接続確認用。監視サービスからも叩ける。 */
export async function GET() {
  const schema = await checkSchema(true);
  const amazon = await getSessionStatus();
  return NextResponse.json(
    {
      ok: schema.ok,
      supabase: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
        connected: schema.connected,
        missingTables: schema.missing,
        error: schema.error,
      },
      line: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_TO_USER_ID),
      ai: Boolean(process.env.OPENROUTER_API_KEY),
      amazon: {
        sessionSaved: amazon.exists,
        loggedIn: amazon.loggedIn,
        isBusiness: amazon.isBusiness ?? amazon.isBusinessFromFile,
        lastVerifiedAt: amazon.lastVerifiedAt,
      },
      time: new Date().toISOString(),
    },
    { status: schema.ok ? 200 : 503 },
  );
}
