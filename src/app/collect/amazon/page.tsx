import { redirect } from "next/navigation";

/**
 * 移動先: /collect/discounts
 *
 * 「Amazon API」はサブタブから外れた。ページだけ残すと StepShell が
 * 未定義のサブタブとして落ちるので、ここは転送だけを行う。
 * 欠測の様子と商品マスタの状態は割引検索の結果から辿れる。
 */
export default function Page() {
  redirect("/collect/discounts");
}
