import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { Header } from "@/components/Header";
import {
  CheckIcon,
  HomeIcon,
  LogInIcon,
  ShieldCheckIcon,
  SparkIcon,
  TagIcon,
} from "@/components/icons";
import { currentUser, ensureSeedUsers } from "@/lib/server/auth";
import { defaultSubHref, stepNumeral, STEPS } from "@/lib/steps";

export const dynamic = "force-dynamic";

/** 使い始めるまでの流れ */
const HOW_TO_START = [
  "設定でAmazonビジネスにログインし、セッションを保存する",
  "割引検索でカテゴリと割引率を選んで実行する",
  "見つかった商品から良いものをカートに入れる",
  "採算が合うものを候補から承認し、在庫として追う",
];

export default async function Page() {
  await ensureSeedUsers();
  const user = await currentUser();

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Header user={user} />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* 見出し */}
        <section className="text-center">
          <BrandLogo height={72} className="mx-auto" />
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Amazonビジネスの割引商品を自動で集め、手数料を全部引いたあとに残る利益で判定し、
            仕入れから売却・振り返りまでを1つの画面で扱うためのシステムです。
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {user ? (
              <>
                <Link href="/dashboard" className="btn btn-primary">
                  <HomeIcon size={17} />
                  ダッシュボードを開く
                </Link>
                <Link href={defaultSubHref(STEPS[0])} className="btn">
                  <TagIcon size={17} className="text-[#c2410c]" />
                  データ収集から始める
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className="btn btn-primary">
                  <LogInIcon size={17} />
                  ログイン
                </Link>
                <Link href="/signup" className="btn">
                  <CheckIcon size={17} className="text-[#0a7a4c]" />
                  新規登録
                </Link>
              </>
            )}
          </div>
        </section>

        {/* 8つの工程 */}
        <section className="mt-12">
          <h2 className="font-serif text-lg font-bold text-[var(--ink)]">
            データ収集から改善まで、8つの工程
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            左のタブがそのまま作業の順番になっています。①から⑧へ進み、⑧で得たことが①へ戻ります。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.key}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
                >
                  <span
                    style={{ backgroundColor: step.soft, color: step.color }}
                    className="flex h-9 w-9 items-center justify-center rounded-lg"
                  >
                    <Icon size={19} />
                  </span>
                  <h3 className="mt-3 font-serif text-sm font-bold text-[var(--ink)]">
                    <span className="num mr-1 text-xs" style={{ color: step.color }}>
                      {stepNumeral(step.no)}
                    </span>
                    {step.label}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">{step.lead}</p>
                  <ul className="mt-2 space-y-0.5 border-t border-[var(--line)] pt-2">
                    {step.subs.map((sub) => (
                      <li key={sub.slug} className="text-[11px] leading-relaxed text-[var(--muted)]">
                        ・{sub.label}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* 使い始めるまで */}
        <section className="mt-12 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-serif text-lg font-bold text-[var(--ink)]">使い始めるまで</h2>
            <ol className="mt-3 space-y-2.5">
              {HOW_TO_START.map((step, i) => (
                <li key={step} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
                    {i + 1}
                  </span>
                  <span className="text-sm text-[var(--ink-soft)]">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-[var(--ink)]">
              <ShieldCheckIcon size={19} className="text-[#0a7a4c]" />
              安全のための決めごと
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-[var(--ink-soft)]">
              <li className="flex items-start gap-2">
                <CheckIcon size={15} className="mt-1 shrink-0 text-[var(--good)]" />
                秘密鍵はサーバー側だけで使い、ブラウザへ渡しません
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon size={15} className="mt-1 shrink-0 text-[var(--good)]" />
                パスワードは平文で保存せず、ハッシュ化して保管します
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon size={15} className="mt-1 shrink-0 text-[var(--good)]" />
                発注直前に価格・在庫・仕入上限を再確認し、外れていれば止めます
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon size={15} className="mt-1 shrink-0 text-[var(--good)]" />
                全自動での購入は既定で無効です
              </li>
            </ul>
          </div>
        </section>

        {/* 構成 */}
        <section className="mt-12">
          <h2 className="font-serif text-lg font-bold text-[var(--ink)]">技術構成</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {[
              { label: "Next.js 16（App Router）", color: "#1a56db", soft: "#eff4ff" },
              { label: "Supabase（PostgreSQL）", color: "#0a7a4c", soft: "#eaf7f1" },
              { label: "Playwright（画面の自動操作）", color: "#c2410c", soft: "#fff1e8" },
              { label: "OpenRouter（AI分析）", color: "#7c3aed", soft: "#f3edff" },
            ].map((t) => (
              <span
                key={t.label}
                style={{ backgroundColor: t.soft, color: t.color, borderColor: t.color }}
                className="rounded-md border px-2.5 py-1 font-semibold"
              >
                {t.label}
              </span>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <SparkIcon size={14} className="text-[#4338ca]" />
            通知は ChatWork / Slack / LINE に対応しています（設定した先だけに送ります）。
          </p>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-[var(--muted)] sm:px-6">
        Amazon 価格差 自動検知システム
      </footer>
    </div>
  );
}
