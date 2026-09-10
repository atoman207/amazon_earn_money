/** PostgREST がスキーマキャッシュに無い列を拒否したときのメッセージ */
export const MISSING_COLUMN_RE =
  /Could not find the '([^']+)' column of '([^']+)' in the schema cache/i;

export async function withCompatiblePayload<T>(
  row: Record<string, unknown>,
  run: (payload: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<{ data: T | null; error: { message: string; code?: string } | null }> {
  let payload: Record<string, unknown> = { ...row };
  for (let i = 0; i < 12; i++) {
    const res = await run(payload);
    if (!res.error) return res;
    const missing = res.error.message.match(MISSING_COLUMN_RE)?.[1];
    if (missing && missing in payload) {
      const next = { ...payload };
      delete next[missing];
      payload = next;
      continue;
    }
    if (payload.status === "canceled" && /check constraint|status_check/i.test(res.error.message)) {
      payload = { ...payload, status: "error" };
      continue;
    }
    return res;
  }
  return { data: null, error: { message: "更新に失敗しました" } };
}
