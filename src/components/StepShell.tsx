import type { ReactNode } from "react";
import { Shell } from "./Shell";
import { SubTabs } from "./SubTabs";
import { getStep, getSub, stepNumeral, type StepKey } from "@/lib/steps";

/**
 * 8工程の各画面の枠。
 *
 * 上に「② 商品分析／利益が見込める商品を自動で抽出」、その下にサブタブ、
 * さらにその下に「いま開いている項目の名前と、そこで何をするか」を出す。
 * どの画面でも同じ位置に同じ情報が出るので、迷子になりにくい。
 */
export function StepShell({
  stepKey,
  sub,
  actions,
  children,
}: {
  stepKey: StepKey;
  sub: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const step = getStep(stepKey);
  const subTab = getSub(stepKey, sub);

  return (
    <Shell title={`${stepNumeral(step.no)} ${step.label}`} actions={actions}>
      <p className="-mt-2 mb-4 text-sm text-[var(--muted)]">{step.lead}</p>

      <SubTabs stepKey={stepKey} />

      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          style={{ color: step.color }}
          className="font-serif text-lg font-bold"
        >
          {subTab.label}
        </h2>
        <p className="text-xs text-[var(--muted)]">{subTab.desc}</p>
      </header>

      {children}
    </Shell>
  );
}
