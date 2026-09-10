import { redirect } from "next/navigation";

/**
 * 移動先: /review/summary
 *
 * 損益は⑧結果分析・改善の「実績の自動集計」になった。
 * 以前のURLで開いた人・ブックマークしていた人がそのまま辿り着けるよう、
 * ここは転送だけを行う。
 */
export default function Page() {
  redirect("/review/summary");
}
