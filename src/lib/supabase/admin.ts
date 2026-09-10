import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * サーバー専用の Supabase クライアント。
 *
 * secret キーは RLS をバイパスするため、ブラウザへ渡してはいけない。
 * "server-only" を import しているので、クライアントコンポーネントから
 * 誤って読み込むとビルド時にエラーになる。
 */
let cached: SupabaseClient<Database> | null = null;

export function isTransientJwtError(message: string | null | undefined) {
  return /jwt issued at future|token used before issued|not yet valid/i.test(message ?? "");
}

async function fetchWithJwtRetry(input: RequestInfo | URL, init?: RequestInit) {
  const delaysMs = [0, 800, 1600];
  let last: Response | undefined;
  for (const delay of delaysMs) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    last = await fetch(input, init);
    if (last.ok) return last;
    const body = await last.clone().text().catch(() => "");
    if (!isTransientJwtError(body) && !isTransientJwtError(last.statusText)) return last;
  }
  return last!;
}

export function supabaseAdmin(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL が設定されていません");
  if (!key) throw new Error("SUPABASE_SECRET_KEY が設定されていません");

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { "x-application-name": "price-radar" },
      fetch: fetchWithJwtRetry,
    },
  });
  return cached;
}
