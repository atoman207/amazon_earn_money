import "server-only";

/**
 * フォームの内容を読む。
 *
 * 画面のフォームからは必ず本文が付いてくるが、cron や外部から本文なしで叩かれると
 * req.formData() は例外を投げる。そこだけのために500を返すのは違うので、
 * 読めなければ空として扱い、既定値で動かす。
 */
export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    return new FormData();
  }
}
