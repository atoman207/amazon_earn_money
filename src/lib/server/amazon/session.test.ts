import { describe, expect, it } from "vitest";
import { summarizeCookies } from "./session";

describe("summarizeCookies", () => {
  it("detects Amazon Business session cookies", () => {
    const summary = summarizeCookies([
      { name: "session-token", value: `"${"a".repeat(40)}"` },
      { name: "at-acbjp", value: "Atza|abcdefghijk" },
      { name: "b2b", value: '"VFJVRQ=="' },
    ]);
    expect(summary.hasSessionToken).toBe(true);
    expect(summary.hasAuthToken).toBe(true);
    expect(summary.isBusiness).toBe(true);
    expect(summary.cookieCount).toBe(3);
  });

  it("treats missing tokens as logged out", () => {
    const summary = summarizeCookies([
      { name: "session-id", value: "123" },
      { name: "b2b", value: "FALSE" },
    ]);
    expect(summary.hasSessionToken).toBe(false);
    expect(summary.hasAuthToken).toBe(false);
    expect(summary.isBusiness).toBe(false);
  });
});
