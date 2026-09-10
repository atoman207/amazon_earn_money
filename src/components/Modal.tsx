"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 中央に出す小窓。
 * Esc と背景クリックで閉じられ、開いている間は後ろがスクロールしないようにする。
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        // 背景を押したときだけ閉じる（中身のドラッグで閉じないように）
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`w-full ${width} overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-lg outline-none`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <h2 className="font-serif text-sm font-bold text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded px-2 py-0.5 text-lg leading-none text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)]"
          >
            ×
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
