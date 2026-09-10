import { redirect } from "next/navigation";

/**
 * 移動先: /purchase/approve
 *
 * 候補は⑤購入承認・仕入れの「あなたの承認で購入」になった。
 * 以前のURLで開いた人・ブックマークしていた人がそのまま辿り着けるよう、
 * ここは転送だけを行う。
 */
export default function Page() {
  redirect("/purchase/approve");
}
