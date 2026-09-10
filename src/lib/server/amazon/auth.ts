import type { Page } from "playwright";
import {
  AMAZON_URLS,
  closeAmazonBrowser,
  launchAmazonBrowser,
  saveContextSession,
  sleep,
  withAmazonLock,
} from "./browser";
import { deleteSessionFiles, saveSessionMeta, sessionExists, summarizeCookies } from "./session";
import type { AmazonAuthState, AmazonBrowserMode } from "./types";

const SIGNIN_RE = /\/ap\/(signin|mfa|cvf|challenge)/i;
const LOGIN_WAIT_MS = 8 * 60_000;

async function pageHints(page: Page) {
  return page.evaluate(() => {
    const greeting =
      document.querySelector("#nav-link-accountList-nav-line-1")?.textContent?.trim() ??
      document.querySelector("#nav-link-accountList .nav-line-1")?.textContent?.trim() ??
      "";
    const accountLine =
      document.querySelector("#nav-link-accountList .nav-line-2")?.textContent?.trim() ??
      document.querySelector("#nav-link-accountList-nav-line-2")?.textContent?.trim() ??
      "";
    const snippet = (document.body?.innerText ?? "").slice(0, 12_000);
    return {
      greeting,
      accountLine,
      signInVisible: Boolean(
        document.querySelector("#ap_email, #ap_password, input[name='email'], #signInSubmit"),
      ),
      mentionsBusiness: /Amazonビジネス|ビジネスアカウント|法人価格/.test(snippet),
    };
  });
}

export async function inspectAmazonAuth(page: Page): Promise<AmazonAuthState> {
  const url = page.url();
  const onSignInPage = SIGNIN_RE.test(url);
  const cookies = await page.context().cookies("https://www.amazon.co.jp/");
  const summary = summarizeCookies(cookies);
  const hints = await pageHints(page).catch(() => ({
    greeting: "",
    accountLine: "",
    signInVisible: onSignInPage,
    mentionsBusiness: false,
  }));

  const greetingLooksLoggedIn =
    Boolean(hints.greeting) && /こんにちは/.test(hints.greeting) && !/ログイン/.test(hints.greeting);
  const greetingLooksSignedOut = /ログイン/.test(hints.greeting) || hints.signInVisible;

  const loggedIn =
    !onSignInPage &&
    !greetingLooksSignedOut &&
    (greetingLooksLoggedIn || (summary.hasSessionToken && summary.hasAuthToken));

  const accountLabel = greetingLooksLoggedIn
    ? hints.greeting
    : hints.accountLine && !/ログイン/.test(hints.accountLine)
      ? hints.accountLine
      : null;

  return {
    loggedIn,
    isBusiness: summary.isBusiness || hints.mentionsBusiness,
    accountLabel,
    url,
    onSignInPage,
    hasSessionToken: summary.hasSessionToken,
    hasAuthToken: summary.hasAuthToken,
  };
}

async function openAmazon(page: Page, preferBusiness: boolean) {
  const target = preferBusiness ? AMAZON_URLS.business : AMAZON_URLS.home;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await sleep(1200);
}

async function persistAuth(page: Page, auth: AmazonAuthState, message: string) {
  await saveContextSession(page.context());
  await saveSessionMeta({
    savedAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    loggedIn: auth.loggedIn,
    isBusiness: auth.isBusiness,
    accountLabel: auth.accountLabel,
    url: auth.url,
    message,
  });
}

export async function waitForManualLogin(page: Page, timeoutMs = LOGIN_WAIT_MS) {
  await openAmazon(page, true);
  let auth = await inspectAmazonAuth(page);
  if (auth.loggedIn) return auth;

  if (!auth.onSignInPage && !SIGNIN_RE.test(page.url())) {
    await page.goto(AMAZON_URLS.signin, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (page.isClosed()) throw new Error("ログイン用ブラウザが閉じられました。");
    auth = await inspectAmazonAuth(page);
    if (auth.loggedIn) return auth;
  }
  throw new Error("ログインが時間内に完了しませんでした。Amazonビジネスへ手動ログインしたあと、もう一度実行してください。");
}

export async function loginAndSaveSession() {
  return withAmazonLock(async () => {
    const handle = await launchAmazonBrowser({
      mode: "headed",
      loadSession: await sessionExists(),
      showLoginBanner: true,
    });
    try {
      const auth = await waitForManualLogin(handle.page);
      if (!auth.loggedIn) {
        throw new Error("ログインを確認できませんでした。");
      }
      const message = auth.isBusiness
        ? "Amazonビジネスとしてログインし、セッションを保存しました。"
        : "ログインは確認できましたが、ビジネスアカウントへの切替が未確認です。Amazonの画面でビジネスに切り替えてから、もう一度保存してください。";
      await persistAuth(handle.page, auth, message);
      return { ...auth, message };
    } finally {
      await closeAmazonBrowser(handle);
    }
  });
}

export async function verifySavedSession(mode: AmazonBrowserMode = "headless") {
  if (!(await sessionExists())) {
    throw new Error("保存済みセッションがありません。先に手動ログインしてセッションを保存してください。");
  }

  return withAmazonLock(async () => {
    const handle = await launchAmazonBrowser({ mode, loadSession: true });
    try {
      await openAmazon(handle.page, true);
      let auth = await inspectAmazonAuth(handle.page);

      if (!auth.loggedIn) {
        await openAmazon(handle.page, false);
        auth = await inspectAmazonAuth(handle.page);
      }

      const message = auth.loggedIn
        ? auth.isBusiness
          ? "仮想ブラウザでAmazonビジネスのログイン状態を確認しました。"
          : "仮想ブラウザでログインは確認できましたが、ビジネス切替が未確認です。"
        : "セッションの期限切れ、または再ログインが必要です。";

      if (auth.loggedIn) {
        await persistAuth(handle.page, auth, message);
      } else {
        await saveSessionMeta({
          lastVerifiedAt: new Date().toISOString(),
          loggedIn: false,
          isBusiness: auth.isBusiness,
          accountLabel: auth.accountLabel,
          url: auth.url,
          message,
        });
      }
      return { ...auth, message };
    } finally {
      await closeAmazonBrowser(handle);
    }
  });
}

async function readProductPage(page: Page) {
  return page.evaluate(`(() => {
    const q = (sel) => {
      const el = document.querySelector(sel);
      const t = el && el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : "";
      return t || null;
    };
    const asinEl = document.querySelector("#ASIN, input[name='ASIN']");
    const fromPath = location.pathname.match(/\\/(?:dp|gp\\/product)\\/([A-Z0-9]{10})/i);
    return {
      title: q("#productTitle") || q("#title") || document.title,
      price:
        q("#corePrice_feature_div .a-offscreen") ||
        q("#corePriceDisplay_desktop_feature_div .a-offscreen") ||
        q(".a-price .a-offscreen") ||
        q("#priceblock_ourprice") ||
        q("#priceblock_dealprice"),
      asin: (asinEl && asinEl.getAttribute("value")) || (fromPath && fromPath[1]) || null,
    };
  })()`) as Promise<{ title: string | null; price: string | null; asin: string | null }>;
}

export async function openAmazonUrl(url: string, opts?: { mode?: AmazonBrowserMode }) {
  if (!(await sessionExists())) {
    throw new Error("保存済みセッションがありません。設定画面から手動ログインして保存してください。");
  }

  return withAmazonLock(async () => {
    const handle = await launchAmazonBrowser({
      mode: opts?.mode ?? "headless",
      loadSession: true,
    });
    try {
      await handle.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await sleep(1500);
      const auth = await inspectAmazonAuth(handle.page);
      if (!auth.loggedIn || auth.onSignInPage) {
        throw new Error("商品ページへのログインに失敗しました。セッションを保存し直してください。");
      }
      const product = await readProductPage(handle.page);
      const message = "仮想ブラウザで商品ページにログインしました。";
      await persistAuth(handle.page, auth, message);
      return { ...product, auth, message };
    } finally {
      await closeAmazonBrowser(handle);
    }
  });
}

export async function withAmazonSession<T>(
  fn: (page: Page) => Promise<T>,
  opts?: { mode?: AmazonBrowserMode },
): Promise<T> {
  if (!(await sessionExists())) {
    throw new Error("保存済みセッションがありません。設定画面から手動ログインして保存してください。");
  }

  return withAmazonLock(async () => {
    const handle = await launchAmazonBrowser({
      mode: opts?.mode ?? "headless",
      loadSession: true,
    });
    try {
      await openAmazon(handle.page, true);
      const auth = await inspectAmazonAuth(handle.page);
      if (!auth.loggedIn) {
        throw new Error("保存済みセッションではログインできませんでした。再ログインしてセッションを保存し直してください。");
      }
      const result = await fn(handle.page);
      await persistAuth(handle.page, auth, "セッションを更新して保存しました。");
      return result;
    } finally {
      await closeAmazonBrowser(handle);
    }
  });
}

export async function clearAmazonSession() {
  await deleteSessionFiles();
  return { ok: true };
}
