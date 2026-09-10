import { redirect } from "next/navigation";
import { defaultSubHref, getStep } from "@/lib/steps";

/** 工程の入口。最初のサブタブへ送る。 */
export default function Page() {
  redirect(defaultSubHref(getStep("collect")));
}
