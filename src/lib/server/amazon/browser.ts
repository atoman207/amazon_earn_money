import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { saveSessionMeta, sessionExists, sessionFilePath } from "./session";
import { sleep } from "./sleep";
import type { AmazonBrowserMode } from "./types";

export { sleep };

const AMAZON_HOME = "https://www.amazon.co.jp/";
const AMAZON_BUSINESS = "https://www.amazon.co.jp/gp/b2b.html";

export const AMAZON_URLS = {
  home: AMAZON_HOME,
  business: AMAZON_BUSINESS,
  signin:
    "https://www.amazon.co.jp/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.co.jp%2Fgp%2Fb2b.html&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=jpflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0",
};

const BANNER_TEXT =
  "price-radar: Amazonビジネスにログインしてください。完了するとこのウィンドウは自動で閉じ、セッションを保存します。";

export interface AmazonBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

let active: Promise<unknown> | null = null;

export async function withAmazonLock<T>(fn: () => Promise<T>): Promise<T> {
  if (active) {
    throw new Error("Amazonブラウザはすでに起動中です。完了してから再実行してください。");
  }
  const run = fn().finally(() => {
    active = null;
  });
  active = run;
  return run;
}

async function launchBrowser(headless: boolean) {
  const args = ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"];
  try {
    return await chromium.launch({
      channel: "chrome",
      headless,
      args,
    });
  } catch {
    return await chromium.launch({ headless, args });
  }
}

export async function launchAmazonBrowser(opts: {
  mode: AmazonBrowserMode;
  loadSession?: boolean;
  showLoginBanner?: boolean;
}): Promise<AmazonBrowser> {
  const headless = opts.mode === "headless";
  const loadSession = opts.loadSession ?? true;
  const browser = await launchBrowser(headless);
  const storageState = loadSession && (await sessionExists()) ? sessionFilePath() : undefined;

  const context = await browser.newContext({
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1400, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    storageState,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  if (opts.showLoginBanner) {
    await context.addInitScript((text) => {
      const inject = () => {
        if (document.getElementById("price-radar-login-banner")) return;
        if (!document.body) return;
        const bar = document.createElement("div");
        bar.id = "price-radar-login-banner";
        bar.textContent = text;
        bar.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1a56db;color:#fff;padding:12px 16px;text-align:center;font:14px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);";
        document.body.prepend(bar);
        document.body.style.scrollMarginTop = "48px";
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", inject, { once: true });
      } else {
        inject();
      }
    }, BANNER_TEXT);
  }

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { browser, context, page };
}

export async function saveContextSession(context: BrowserContext) {
  await context.storageState({ path: sessionFilePath() });
  await saveSessionMeta({ savedAt: new Date().toISOString() });
}

export async function closeAmazonBrowser(handle: AmazonBrowser) {
  await handle.context.close().catch(() => undefined);
  await handle.browser.close().catch(() => undefined);
}
