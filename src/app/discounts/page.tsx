import { redirect } from "next/navigation";

/**
 * 移動先: /collect/discounts
 *
 * 割引検索は①データ収集の最初の項目になった。
 * 以前のURLで開いた人・ブックマークしていた人がそのまま辿り着けるよう、
 * ここは転送だけを行う。
 */
export default function Page() {
  redirect("/collect/discounts");
}
