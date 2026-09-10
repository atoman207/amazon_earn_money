import { redirect } from "next/navigation";

/**
 * 移動先: /inventory/monitor
 *
 * 在庫は⑥販売・在庫管理の「価格を継続監視」になった。
 * 以前のURLで開いた人・ブックマークしていた人がそのまま辿り着けるよう、
 * ここは転送だけを行う。
 */
export default function Page() {
  redirect("/inventory/monitor");
}
