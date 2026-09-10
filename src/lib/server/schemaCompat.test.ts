import { describe, expect, it } from "vitest";
import { withCompatiblePayload } from "./schemaCompat";

describe("withCompatiblePayload", () => {
  it("schema cache に無い列を外して再試行する", async () => {
    const seen: string[][] = [];
    const res = await withCompatiblePayload({ a: 1, cancel_requested: false, heartbeat_at: "x" }, async (payload) => {
      seen.push(Object.keys(payload).sort());
      if ("cancel_requested" in payload) {
        return {
          data: null,
          error: {
            message: "Could not find the 'cancel_requested' column of 'discount_scans' in the schema cache",
          },
        };
      }
      if ("heartbeat_at" in payload) {
        return {
          data: null,
          error: {
            message: "Could not find the 'heartbeat_at' column of 'discount_scans' in the schema cache",
          },
        };
      }
      return { data: payload, error: null };
    });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ a: 1 });
    expect(seen).toEqual([
      ["a", "cancel_requested", "heartbeat_at"],
      ["a", "heartbeat_at"],
      ["a"],
    ]);
  });
});
