"use client";

import { useRef, useState } from "react";
import { ImageIcon, TrashIcon, UserIcon } from "./icons";

/** 保存する画像の一辺。大きな写真をそのまま持たないよう、ここまで縮める。 */
const MAX_SIDE = 160;

/**
 * アバターの選択。
 * 選んだ画像をブラウザ側で正方形に切って縮め、data URL にしてから送る。
 * 画像置き場（ストレージ）を用意しなくても済むようにするため。
 */
export function AvatarPicker({
  value,
  onChange,
  label = "アバター",
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("画像ファイルを選んでください");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await shrinkToSquare(file);
      onChange(dataUrl);
    } catch {
      setError("画像を読み込めませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
        <ImageIcon size={15} className="text-[#7c3aed]" />
        {label}
      </span>
      <div className="flex items-center gap-3">
        {value ? (
          // 選んだ画像は data URL なので、next/image を通さずそのまま出す
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full border border-[var(--line)] object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--line-strong)] text-[var(--muted)]">
            <UserIcon size={26} />
          </span>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImageIcon size={15} className="text-[#7c3aed]" />
            {busy ? "読み込み中…" : value ? "選び直す" : "画像を選ぶ"}
          </button>
          {value && (
            <button type="button" className="btn" onClick={() => onChange("")}>
              <TrashIcon size={15} className="text-[var(--bad)]" />
              外す
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
          e.target.value = "";
        }}
      />
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        正方形に切り取り、{MAX_SIDE}px まで縮めて保存します。
      </p>
      {error && <p className="mt-1 text-[11px] text-[var(--bad)]">{error}</p>}
    </div>
  );
}

/** 中央を正方形に切り、MAX_SIDE まで縮めた JPEG の data URL を返す */
async function shrinkToSquare(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const target = Math.min(side, MAX_SIDE);

  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas を使えません");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target, target);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
