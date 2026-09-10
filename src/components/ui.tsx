import type { ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5">
          <div>
            {title && (
              <h2 className="text-sm font-bold text-[var(--ink)]">{title}</h2>
            )}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const color =
    tone === "good"
      ? "text-[var(--good)]"
      : tone === "bad"
        ? "text-[var(--bad)]"
        : tone === "warn"
          ? "text-[var(--warn)]"
          : "text-[var(--ink)]";
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className={`num mt-1 text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "good" | "bad" | "warn" | "accent";
}) {
  const map = {
    default: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)]",
    good: "border-[var(--good)]/25 bg-[var(--good-soft)] text-[var(--good)]",
    bad: "border-[var(--bad)]/25 bg-[var(--bad-soft)] text-[var(--bad)]",
    warn: "border-[var(--warn)]/25 bg-[var(--warn-soft)] text-[var(--warn)]",
    accent: "border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  } as const;
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}

export function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold text-[var(--muted)] ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

/**
 * 押して並べ替えできる見出し。
 * どの列でも並べ替えられることが分かるよう、押していない列にも上下の矢印を出す。
 * 押している列は向き（▲昇順 / ▼降順）をはっきり見せる。
 */
export function SortableTh({
  children,
  right = false,
  active = false,
  direction = "desc",
  onSort,
}: {
  children: ReactNode;
  right?: boolean;
  active?: boolean;
  direction?: "asc" | "desc";
  onSort: () => void;
}) {
  const label = active ? (direction === "asc" ? "昇順" : "降順") : "並べ替えなし";
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={`whitespace-nowrap border-b border-[var(--line)] bg-[var(--surface-2)] p-0 text-xs font-semibold ${
        active ? "text-[var(--ink)]" : "text-[var(--muted)]"
      }`}
    >
      <button
        type="button"
        onClick={onSort}
        title={`${label}で並べ替え`}
        className={`flex w-full items-center gap-1 px-3 py-2 transition hover:bg-[var(--surface)] ${
          right ? "justify-end" : "justify-start"
        }`}
      >
        <span>{children}</span>
        <span
          aria-hidden="true"
          className={`text-[10px] leading-none ${
            active ? "text-[var(--accent)]" : "text-[var(--line-strong)]"
          }`}
        >
          {active ? (direction === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

export function Td({
  children,
  right = false,
  className = "",
}: {
  children: ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-[var(--line)] px-3 py-2 text-sm ${right ? "num text-right" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

export function Money({ value, signed = false }: { value: number; signed?: boolean }) {
  const tone = value > 0 ? "text-[var(--good)]" : value < 0 ? "text-[var(--bad)]" : "";
  const sign = signed && value > 0 ? "+" : "";
  return (
    <span className={`num font-semibold ${tone}`}>
      {sign}
      {Math.round(value).toLocaleString("ja-JP")}円
    </span>
  );
}

/**
 * 割合を横棒で見せる。数字だけだと「どのくらい足りないか」が伝わらないため、
 * 欠けている部分も同じ長さの枠の中に残して見せる。
 */
export function Bar({
  value,
  max,
  color = "var(--accent)",
  height = 8,
}: {
  value: number;
  max: number;
  color?: string;
  height?: number;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span
      style={{ height }}
      className="block w-full overflow-hidden rounded bg-[var(--surface-2)]"
    >
      <span
        style={{ width: `${(ratio * 100).toFixed(1)}%`, backgroundColor: color, height }}
        className="block"
      />
    </span>
  );
}

/** 注意書き。色で強さを分ける。 */
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "good" | "warn" | "bad";
  title?: string;
  children: ReactNode;
}) {
  const map = {
    info: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-soft)]",
    good: "border-[var(--good)]/30 bg-[var(--good-soft)] text-[var(--good)]",
    warn: "border-[var(--warn)]/40 bg-[var(--warn-soft)] text-[var(--warn)]",
    bad: "border-[var(--bad)]/30 bg-[var(--bad-soft)] text-[var(--bad)]",
  } as const;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${map[tone]}`}>
      {title && <div className="mb-1 font-bold">{title}</div>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/** 「項目：値」の並び。内訳を出すときに使う。 */
export function DefList({
  items,
  className = "",
}: {
  items: Array<{ label: string; value: ReactNode; hint?: string }>;
  className?: string;
}) {
  return (
    <dl className={`divide-y divide-[var(--line)]/60 ${className}`}>
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-sm text-[var(--muted)]">
            {it.label}
            {it.hint && <span className="ml-1 text-[11px]">（{it.hint}）</span>}
          </dt>
          <dd className="text-sm font-medium text-[var(--ink)]">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
