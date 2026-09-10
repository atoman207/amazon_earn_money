import fs from "node:fs";
import path from "node:path";

/**
 * .env.local / .env を読み込む。
 *
 * Next から起動されたときは環境変数を引き継いでいるので何も起きない。
 * `npm run amazon:scan -- <id>` のように素の Node から動かしたときに、
 * Supabase の接続情報が無くて落ちるのを防ぐためのもの。
 * すでに入っている値は上書きしない（起動元の指定を優先する）。
 */
export function loadEnv(root: string = process.cwd()) {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const key = line.slice(0, i).trim();
      const value = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

loadEnv();
