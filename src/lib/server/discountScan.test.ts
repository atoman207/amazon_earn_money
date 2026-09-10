import { describe, expect, it } from "vitest";
import { isStaleScan } from "./discountScan";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("isStaleScan", () => {
  it("生存確認が10分以上途切れていたら落ちたとみなす", () => {
    expect(isStaleScan({ heartbeat_at: minutesAgo(11), created_at: minutesAgo(11) }, NOW)).toBe(true);
  });

  it("生存確認が続いていれば、長時間かかっていても止めない", () => {
    expect(
      isStaleScan({ heartbeat_at: minutesAgo(1), created_at: minutesAgo(240) }, NOW),
    ).toBe(false);
  });

  it("heartbeat 列が無いDBでは、作成から3時間は待つ（実行中を巻き添えにしない）", () => {
    expect(isStaleScan({ created_at: minutesAgo(30) }, NOW)).toBe(false);
    expect(isStaleScan({ heartbeat_at: null, created_at: minutesAgo(30) }, NOW)).toBe(false);
    expect(isStaleScan({ created_at: minutesAgo(181) }, NOW)).toBe(true);
  });
});
