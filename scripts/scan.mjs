/** 開発用: サーバーを立てずにスキャンを叩く（Next の API 経由） */
import { loadEnv } from "./lib.mjs";
loadEnv();
const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const key = process.env.CRON_SECRET;
const res = await fetch(`${base}/api/cron/scan?key=${encodeURIComponent(key ?? "")}`);
console.log(res.status, await res.text());
