import "server-only";
import { isTransientJwtError, supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/supabase/database.types";

export interface SchemaStatus {
  ok: boolean;
  connected: boolean;
  missing: string[];
  error: string | null;
  jwtClockSkew: boolean;
}

let memo: { at: number; value: SchemaStatus; ttl: number } | null = null;

/**
 * DBへ実際に問い合わせて、接続とテーブルの有無を確かめる。
 * 未作成なら画面に手順を出すために使う。成功時は30秒だけ覚えておく。
 */
export async function checkSchema(force = false): Promise<SchemaStatus> {
  if (!force && memo && Date.now() - memo.at < memo.ttl) return memo.value;

  const missing: string[] = [];
  let connected = false;
  let error: string | null = null;
  let jwtClockSkew = false;

  try {
    const db = supabaseAdmin();
    const results = await Promise.all(
      TABLES.map(async (t) => {
        // head:true のカウントは存在しないテーブルでもエラーを返さないため、実際に1行取りにいく
        const { error: e } = await db.from(t).select("*").limit(1);
        return { table: t, error: e };
      }),
    );
    connected = true;
    for (const r of results) {
      if (!r.error) continue;
      // PGRST205 / 42P01 = テーブルが存在しない
      const code = (r.error as { code?: string }).code ?? "";
      if (code === "PGRST205" || code === "42P01" || /does not exist|schema cache/i.test(r.error.message)) {
        missing.push(r.table);
      } else if (isTransientJwtError(r.error.message)) {
        jwtClockSkew = true;
        error = `${r.table}: ${r.error.message}`;
      } else {
        error = `${r.table}: ${r.error.message}`;
      }
    }
  } catch (e) {
    connected = false;
    error = e instanceof Error ? e.message : String(e);
    jwtClockSkew = isTransientJwtError(error);
  }

  const value: SchemaStatus = {
    ok: connected && missing.length === 0 && !error,
    connected,
    missing,
    error,
    jwtClockSkew,
  };
  const ttl = value.ok ? 30_000 : jwtClockSkew ? 0 : 5_000;
  memo = ttl > 0 ? { at: Date.now(), value, ttl } : null;
  return value;
}
