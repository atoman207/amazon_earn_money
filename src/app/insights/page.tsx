import { redirect } from "next/navigation";

/**
 * 移動先: /review/precision
 *
 * AI分析は⑧結果分析・改善の「より精度の高い仕入れ判断へ」になった。
 * 以前のURLで開いた人・ブックマークしていた人がそのまま辿り着けるよう、
 * ここは転送だけを行う。
 */
export default function Page() {
  redirect("/review/precision");
}
