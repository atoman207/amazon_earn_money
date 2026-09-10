import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

/** .env.local を読む（dotenv を足さずに済ませる） */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(projectRoot, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}

export function admin() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY を .env.local に設定してください");
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const delays = [0, 800, 1600];
        let last;
        for (const delay of delays) {
          if (delay) await new Promise((r) => setTimeout(r, delay));
          last = await fetch(input, init);
          if (last.ok) return last;
          const body = await last.clone().text().catch(() => "");
          if (!/jwt issued at future|token used before issued|not yet valid/i.test(body)) return last;
        }
        return last;
      },
    },
  });
}

export const TABLES = [
  "products",
  "watch_universe",
  "price_observations",
  "price_stats",
  "settings",
  "opportunities",
  "notifications",
  "orders",
  "positions",
  "exit_signals",
  "sales",
  "ai_analyses",
  "audit_logs",
  "discount_scans",
  "discount_products",
  "cart_items",
  "app_users",
  "sessions",
];

export const migrationPath = path.join(projectRoot, "supabase", "migrations", "0001_init.sql");
/** スキーマは単一ファイルのみ。変更は 0001_init.sql へ追記する */
export const migrationFiles = [migrationPath];
