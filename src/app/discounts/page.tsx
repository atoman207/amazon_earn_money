import { redirect } from "next/navigation";

/**
 * 移動先: /collect/amazon
 *
 * 割引検索は①データ収集の「Amazon API」になった。
 * 以前のURLで開いた人・ブックマークしていた人がそのまま辿り着けるよう、
 * ここは転送だけを行う。
 */
export default function Page() {
  redirect("/collect/amazon");
}
