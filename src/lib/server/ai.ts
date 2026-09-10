import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * AI は「言葉で書かれた情報を読み解く」ことだけに使う。
 * 提案書 5節のとおり、お金の計算には一切関わらせない。
 * 数値はすべて計算済みのものを入力として渡し、AIの出力は候補の並べ替えと
 * レポートの文章にしか影響させない。
 */

export type AiTask = "trend" | "niche" | "risk";

interface OpenRouterMessage {
  role: "system" | "user";
  content: string;
}

async function callOpenRouter(
  messages: OpenRouterMessage[],
  model: string,
): Promise<{ text: string; model: string } | { error: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { error: "OPENROUTER_API_KEY が未設定です" };

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "price-radar",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_tokens: 2000,
      }),
    });
    if (!res.ok) return { error: `OpenRouter ${res.status}: ${(await res.text()).slice(0, 400)}` };
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return { text, model: json.model ?? model };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export interface NicheCandidate {
  asin: string;
  title: string;
  verdict: "狙い目" | "様子見" | "避ける";
  reason: string;
  confidence: number;
}

/**
 * ニッチ発見（提案書 5節）。
 * 競合が少なく、売れていて、参入に許可が要らない商品を、理由つきで選ぶ。
 */
export async function analyzeNiche(): Promise<{
  ok: boolean;
  items: NicheCandidate[];
  error?: string;
  model?: string;
}> {
  const db = supabaseAdmin();

  // 判断材料はすべてこちらで計算し、事実だけを渡す
  const { data: products } = await db.from("products").select("*").eq("restricted", false).limit(60);
  if (!products?.length) return { ok: false, items: [], error: "商品がありません" };

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const facts: Array<Record<string, unknown>> = [];

  for (const p of products) {
    const { data: obs } = await db
      .from("price_observations")
      .select("sell_price, offer_count, sales_rank, observed_at")
      .eq("asin", p.asin)
      .gte("observed_at", since)
      .order("observed_at", { ascending: false })
      .limit(120);
    if (!obs?.length) continue;

    const prices = obs.map((o) => o.sell_price).filter((v): v is number => typeof v === "number");
    const offers = obs.map((o) => o.offer_count).filter((v): v is number => typeof v === "number");
    const ranks = obs.map((o) => o.sales_rank).filter((v): v is number => typeof v === "number");
    if (!prices.length) continue;

    const avg = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length;
    facts.push({
      asin: p.asin,
      title: p.title,
      category: p.category,
      平均価格: Math.round(avg(prices)),
      競合出品者数: offers.length ? Math.round(avg(offers)) : null,
      平均ランキング: ranks.length ? Math.round(avg(ranks)) : null,
      観測件数: obs.length,
    });
  }

  if (!facts.length) return { ok: false, items: [], error: "価格履歴がありません" };

  const model = process.env.OPENROUTER_MODEL_SMART ?? "anthropic/claude-sonnet-5";
  const result = await callOpenRouter(
    [
      {
        role: "system",
        content: [
          "あなたはAmazon物販のリサーチ担当です。与えられた事実だけを根拠に判断してください。",
          "事実にない数字を作ってはいけません。判断材料が足りない場合は verdict を「様子見」にしてください。",
          "「狙い目」は、競合出品者数が少なく（目安5社以下）、ランキングが良く（売れている）、",
          "価格帯が扱いやすい商品に限ります。",
          'JSONで {"items":[{"asin":"...","title":"...","verdict":"狙い目|様子見|避ける","reason":"80文字以内の日本語","confidence":0〜1}]} を返してください。',
          "items は最大8件。confidence は根拠の強さです。",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify({ 商品: facts }, null, 1) },
    ],
    model,
  );

  if ("error" in result) return { ok: false, items: [], error: result.error };

  try {
    const parsed = JSON.parse(result.text) as { items?: NicheCandidate[] };
    const known = new Set(products.map((p) => p.asin));
    // 実在しない商品を返してきたら捨てる（幻覚対策）
    const items = (parsed.items ?? []).filter((i) => known.has(i.asin)).slice(0, 8);

    await db.from("ai_analyses").insert({
      task: "niche",
      target: null,
      model: result.model,
      output: { items } as never,
      confidence: items.length ? items.reduce((a, c) => a + (c.confidence ?? 0), 0) / items.length : null,
    });

    return { ok: true, items, model: result.model };
  } catch {
    return { ok: false, items: [], error: "AIの出力を解釈できませんでした" };
  }
}

export async function latestAnalysis(task: AiTask) {
  const { data } = await supabaseAdmin()
    .from("ai_analyses")
    .select("*")
    .eq("task", task)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
