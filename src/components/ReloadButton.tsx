"use client";

export function ReloadButton() {
  return (
    <button type="button" className="btn mt-4" onClick={() => window.location.reload()}>
      再読み込み
    </button>
  );
}
