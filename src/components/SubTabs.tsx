"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getStep, type StepKey } from "@/lib/steps";

/**
 * 工程の中のサブタブ。図解でカードに並んでいる項目がそのまま1枚ずつになる。
 * 選択中のものだけ工程の色をつけ、他は下線だけにして、同じ工程の中にいることを保つ。
 *
 * 受け取るのは工程のキーだけにしている。Step にはアイコン（関数）が入っていて、
 * サーバーからクライアントへはそのまま渡せないため、定義はここで読み直す。
 */
export function SubTabs({ stepKey }: { stepKey: StepKey }) {
  const path = usePathname();
  const step = getStep(stepKey);

  return (
    <nav
      aria-label={`${step.label}の項目`}
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-[var(--line)] px-1"
    >
      {step.subs.map((sub, i) => {
        const href = `${step.href}/${sub.slug}`;
        const on = path === href;
        return (
          <Link
            key={sub.slug}
            href={href}
            aria-current={on ? "page" : undefined}
            style={on ? { color: step.color, borderColor: step.color } : undefined}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
              on
                ? "font-semibold"
                : "border-transparent font-medium text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <span
              style={on ? { backgroundColor: step.soft, color: step.color } : undefined}
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                on ? "" : "bg-[var(--surface-2)] text-[var(--muted)]"
              }`}
            >
              {i + 1}
            </span>
            <span className="whitespace-nowrap">{sub.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
