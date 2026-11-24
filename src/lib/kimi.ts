// Moonshot's Kimi, which speaks the OpenAI chat API. Thinking is off by
// default here: for extraction it multiplies latency and tokens without
// helping (measured during M1).

import { need } from "./env.ts";
import { logUsage, type DB } from "./db.ts";
import { fetchRetry, sleep } from "./util.ts";

const BASE = "https://api.moonshot.ai/v1";

// The account allows 200 requests per minute (organization-wide, so merges
// on the live site share it). Space request starts to stay under 180/min.
const MIN_GAP_MS = 60_000 / Number(process.env.KIMI_RPM ?? 180);
let nextSlot = 0;
async function rateLimit(): Promise<void> {
  const t = Date.now();
  const slot = Math.max(t, nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  if (slot > t) await sleep(slot - t);
}

/** How long a request started now would wait for its turn, in ms. */
export function queueDelayMs(): number {
  return Math.max(0, nextSlot - Date.now());
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  purpose: string;
  json?: boolean;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export async function chat(db: DB, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const model = opts.model ?? "kimi-k3";
  const body: Record<string, unknown> = { model, messages };
  if (opts.json) body.response_format = { type: "json_object" };
  if (!opts.thinking) body.thinking = { type: "disabled" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  await rateLimit();
  const res = await fetchRetry(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${need("MOONSHOT_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    choices?: { message: { content: string }; finish_reason: string }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    error?: { message: string };
  };
  if (!res.ok || !json.choices?.[0]) throw new Error(`Kimi ${res.status}: ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  if (json.usage) logUsage(db, { provider: "kimi", model, purpose: opts.purpose, input: json.usage.prompt_tokens, output: json.usage.completion_tokens });
  return json.choices[0].message.content;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date: string;
  site_name: string;
}

// Kimi's web search endpoint (POST /v1/tools/search). Always searches;
// billed per call that returns results. Shares the request rate limit.
export async function search(db: DB, query: string, limit = 6): Promise<SearchResult[]> {
  await rateLimit();
  const res = await fetchRetry(`${BASE}/tools/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${need("MOONSHOT_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ text_query: query, limit, timeout_seconds: 20 }),
  });
  if (!res.ok) throw new Error(`Kimi search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { search_results?: SearchResult[] };
  const results = json.search_results ?? [];
  logUsage(db, { provider: "kimi", model: "tools/search", purpose: "search", input: results.length ? 1 : 0, output: results.length });
  return results;
}

// The account balance in USD, used to measure what a run actually cost.
export async function balance(): Promise<number | null> {
  const res = await fetchRetry(`${BASE}/users/me/balance`, { headers: { authorization: `Bearer ${need("MOONSHOT_API_KEY")}` } });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { available_balance: number } };
  return json.data?.available_balance ?? null;
}
