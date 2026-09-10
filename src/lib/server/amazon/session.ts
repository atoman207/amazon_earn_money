import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AmazonCookie, AmazonSessionMeta, AmazonSessionStatus, AmazonStorageState } from "./types";

const DEFAULT_META: AmazonSessionMeta = {
  savedAt: null,
  lastVerifiedAt: null,
  loggedIn: null,
  isBusiness: null,
  accountLabel: null,
  url: null,
  message: null,
};

/*
 * 以下の fs 呼び出しには turbopackIgnore を付けている。
 *
 * 保存先はログイン時に作られる実行時の状態で、ビルドの入力ではない。印を付けないと
 * Turbopack が「パスを静的に決められない」と判断してプロジェクト全体（public を含む）
 * を関数バンドルへ取り込み、Vercel のデプロイが太って上限に当たる。
 */
export function sessionFilePath() {
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.AMAZON_SESSION_PATH ??
      path.join(process.cwd(), "amazon_session.json"),
  );
}

export function sessionMetaPath() {
  const file = sessionFilePath();
  return path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.meta.json`);
}

function stripQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function decodeB2bValue(raw: string | undefined) {
  if (!raw) return null;
  const v = stripQuotes(raw);
  if (/^true$/i.test(v)) return "TRUE";
  try {
    const decoded = Buffer.from(v, "base64").toString("utf8").replace(/"/g, "");
    if (/^true$/i.test(decoded)) return "TRUE";
  } catch {
    /* not base64 */
  }
  return v;
}

export function summarizeCookies(cookies: AmazonCookie[]) {
  const names = new Set(cookies.map((c) => c.name));
  const b2b = cookies.find((c) => c.name === "b2b");
  return {
    cookieCount: cookies.length,
    hasSessionToken: cookies.some((c) => c.name === "session-token" && stripQuotes(c.value).length > 20),
    hasAuthToken: cookies.some((c) => c.name === "at-acbjp" && stripQuotes(c.value).length > 10),
    isBusiness: decodeB2bValue(b2b?.value) === "TRUE",
    names,
  };
}

export async function sessionExists() {
  try {
    await stat(/*turbopackIgnore: true*/ sessionFilePath());
    return true;
  } catch {
    return false;
  }
}

export async function loadStorageState(): Promise<AmazonStorageState | null> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ sessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as AmazonStorageState;
    if (!parsed || !Array.isArray(parsed.cookies)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadSessionMeta(): Promise<AmazonSessionMeta> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ sessionMetaPath(), "utf8");
    return { ...DEFAULT_META, ...(JSON.parse(raw) as Partial<AmazonSessionMeta>) };
  } catch {
    return { ...DEFAULT_META };
  }
}

export async function saveSessionMeta(patch: Partial<AmazonSessionMeta>) {
  const current = await loadSessionMeta();
  const next: AmazonSessionMeta = { ...current, ...patch };
  await mkdir(/*turbopackIgnore: true*/ path.dirname(sessionMetaPath()), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ sessionMetaPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function getSessionStatus(): Promise<AmazonSessionStatus> {
  const meta = await loadSessionMeta();
  const state = await loadStorageState();
  let savedFileAt: string | null = null;
  try {
    const s = await stat(/*turbopackIgnore: true*/ sessionFilePath());
    savedFileAt = s.mtime.toISOString();
  } catch {
    savedFileAt = null;
  }

  const summary = state ? summarizeCookies(state.cookies) : null;
  return {
    ...meta,
    exists: Boolean(state),
    cookieCount: summary?.cookieCount ?? 0,
    hasSessionToken: summary?.hasSessionToken ?? false,
    hasAuthToken: summary?.hasAuthToken ?? false,
    isBusinessFromFile: summary ? summary.isBusiness : null,
    savedFileAt: meta.savedAt ?? savedFileAt,
  };
}

export async function deleteSessionFiles() {
  await Promise.all(
    [sessionFilePath(), sessionMetaPath()].map(async (p) => {
      try {
        await unlink(/*turbopackIgnore: true*/ p);
      } catch {
        /* already gone */
      }
    }),
  );
}
