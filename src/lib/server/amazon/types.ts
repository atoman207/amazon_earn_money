export interface AmazonCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface AmazonStorageState {
  cookies: AmazonCookie[];
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface AmazonSessionMeta {
  savedAt: string | null;
  lastVerifiedAt: string | null;
  loggedIn: boolean | null;
  isBusiness: boolean | null;
  accountLabel: string | null;
  url: string | null;
  message: string | null;
}

export interface AmazonAuthState {
  loggedIn: boolean;
  isBusiness: boolean;
  accountLabel: string | null;
  url: string;
  onSignInPage: boolean;
  hasSessionToken: boolean;
  hasAuthToken: boolean;
}

export interface AmazonSessionStatus extends AmazonSessionMeta {
  exists: boolean;
  cookieCount: number;
  hasSessionToken: boolean;
  hasAuthToken: boolean;
  isBusinessFromFile: boolean | null;
  savedFileAt: string | null;
}

export type AmazonBrowserMode = "headed" | "headless";

export interface ScrapedProduct {
  asin: string;
  name: string;
  quantity: string | null;
  referencePrice: number | null;
  unitPrice: number | null;
  discountRate: number | null;
  discountAmount: number | null;
  imageUrl: string | null;
  productUrl: string;
}

export interface AmazonProductPage {
  auth: AmazonAuthState;
  title: string | null;
  price: string | null;
  asin: string | null;
}
