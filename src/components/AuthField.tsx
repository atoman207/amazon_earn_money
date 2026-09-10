"use client";

import type { ComponentType, SVGProps } from "react";

/**
 * ログイン・登録フォームの1行。
 * 左に色付きのアイコンを置いて、何を入れる欄なのか一目で分かるようにする。
 */
export function AuthField({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  icon: Icon,
  color,
  required = false,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  color: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
        <Icon size={15} style={{ color }} />
        {label}
        {required && <span className="text-[var(--bad)]">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field w-full"
      />
      {hint && <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}
