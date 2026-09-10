import { redirect } from "next/navigation";
import { defaultSubHref, getStep } from "@/lib/steps";

export default function Page() {
  redirect(defaultSubHref(getStep("analysis")));
}
