export const yen = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `${Math.round(n).toLocaleString("ja-JP")}円`;

export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(digits)}%`;

export const days = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${Math.round(n)}日`;

export const stars = (confidence: number) => {
  const filled = Math.max(1, Math.min(5, Math.round(confidence * 5)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
};

export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const dateOnly = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
};

export const holdingDays = (openedAt: string, until: string | null = null) => {
  const start = new Date(openedAt).getTime();
  const end = until ? new Date(until).getTime() : Date.now();
  return Math.max(0, (end - start) / 86_400_000);
};
