import { NextResponse } from "next/server";
import {
  CATEGORY_OPTIONS,
  DISCOUNT_OPTIONS,
  SEND_METHODS,
  SORT_OPTIONS,
} from "@/lib/server/amazon/catalog";

export const dynamic = "force-static";

/** 画面が使う選択肢（カテゴリ・割引率・並べ替え・送信方式） */
export async function GET() {
  return NextResponse.json({
    ok: true,
    categories: CATEGORY_OPTIONS,
    discounts: DISCOUNT_OPTIONS,
    sorts: SORT_OPTIONS,
    sendMethods: SEND_METHODS,
  });
}
