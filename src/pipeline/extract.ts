// Step 3: Kimi reads the items that passed the prefilter, in batches, and
// lists the companies each one names. It is told to skip giants and
// non-companies, which Jev and the denylist check again later.

import { type DB, tx } from "../lib/db.ts";
import { chat } from "../lib/kimi.ts";
import { mapLimit, now } from "../lib/util.ts";

const BATCH = 20;
const MAX_CHARS = 2000;
const CONTEXTS = ["recommended", "criticized", "employer", "own_product", "neutral"] as const;

const SYSTEM = `You read Hacker News comments and posts and list the companies they name.

For each item, list companies and commercial products made by companies that the item's "text" explicitly names.
The "thread" field is the title of the discussion, given only for context: never list a company because the thread title names it.
Use the brand name people use (for example "Cursor", not "Anysphere"), and the product's main name rather than a plan, tier, feature or model version ("OpenCode", not "OpenCode Go"; "DeepSeek", not "DeepSeek V4.1 Flash").
For an AI model, list the company that makes it, not the model ("DeepSeek" for "DeepSeek V4"); if the maker is a big lab or unknown, skip it.
Give the company's main website domain only if you are confident, else null.

Do NOT list:
- big tech and other large or public companies, and household names (Google, Apple, Microsoft, Amazon, Meta, OpenAI, Anthropic, Stripe, Netflix, Nvidia, Tesla, Oracle, IBM, Salesforce, Adobe, Cloudflare, Shopify and similar);
- open-source projects with no company behind them, programming languages, frameworks, protocols, file formats, operating systems, hardware standards;
- people, governments, universities, nonprofits, publications and news sites, and Hacker News itself;
- generic categories ("a CRM", "some startup").
For a Show HN or Launch HN post, include the product being launched only if it looks like a company's commercial product (a business, pricing, signups, a team, "we", YC), not a hobby or side project or plain open-source library.

For each company give:
- "context": "recommended" (praised or suggested), "criticized", "employer" (the author works or worked there), "own_product" (the author built it or it is the post's own launch), or "neutral";
- "evidence": a short exact quote from the item, at most 15 words, that names it.

Answer with JSON only, in this shape, and include only items that name at least one company:
{"items": [{"id": 123, "companies": [{"name": "...", "domain": "example.com", "context": "recommended", "evidence": "..."}]}]}`;

interface Row {
  id: number;
  kind: string;
  story_title: string | null;
  text: string;
}

interface Extracted {
  items?: { id: number; companies?: { name?: string; domain?: string | null; context?: string; evidence?: string }[] }[];
}

function promptFor(rows: Row[]): string {
  const items = rows.map((r) => ({
    id: r.id,
    type: r.kind === "comment" ? "comment" : r.kind === "launch_hn" ? "Launch HN post" : "Show HN post",
    ...(r.kind === "comment" && r.story_title ? { thread: r.story_title } : {}),
    text: r.text.length > MAX_CHARS ? r.text.slice(0, MAX_CHARS) + " …" : r.text,
  }));
  return JSON.stringify({ items });
}

export async function extract(db: DB, opts: { limit?: number; concurrency?: number; log?: (s: string) => void } = {}): Promise<{ items: number; mentions: number; failedBatches: number; blockedItems: number }> {
  const log = opts.log ?? console.log;
  const rows = db
    .prepare(`SELECT id, kind, story_title, text FROM items WHERE prefilter = 'pass' AND extracted_at IS NULL ORDER BY created_at DESC LIMIT ?`)
    .all(opts.limit ?? 1_000_000) as unknown as Row[];
  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  const insert = db.prepare(`INSERT OR IGNORE INTO mentions (item_id, name, domain, context, evidence) VALUES (?, ?, ?, ?, ?)`);
  const done = db.prepare(`UPDATE items SET extracted_at = ? WHERE id = ?`);
  let mentions = 0;
  let failedBatches = 0;
  let blockedItems = 0;
  let finished = 0;

  // Kimi's content filter rejects some HN text ("considered high risk").
  // Split a rejected batch in halves until the offending item is alone, then
  // mark just that item read with no mentions.
  const BLOCKED = /considered high risk|content_filter|sensitive/i;
  async function read(batch: Row[]): Promise<Extracted> {
    try {
      const out = await chat(db, [{ role: "system", content: SYSTEM }, { role: "user", content: promptFor(batch) }], { purpose: "extract", json: true });
      return JSON.parse(out) as Extracted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BLOCKED.test(msg)) throw err;
      if (batch.length === 1) {
        blockedItems++;
        return { items: [] };
      }
      const mid = Math.ceil(batch.length / 2);
      const [a, b] = await Promise.all([read(batch.slice(0, mid)), read(batch.slice(mid))]);
      return { items: [...(a.items ?? []), ...(b.items ?? [])] };
    }
  }

  // Any other 4xx (except rate limiting) means our request is wrong, so stop
  // rather than fail every remaining batch the same way.
  let fatal: string | null = null;
  await mapLimit(batches, opts.concurrency ?? 8, async (batch) => {
    if (fatal) return;
    let parsed: Extracted;
    try {
      parsed = await read(batch);
    } catch (err) {
      failedBatches++;
      const msg = err instanceof Error ? err.message : String(err);
      if (/^Kimi 4(?!29)\d\d/.test(msg)) fatal = msg;
      log(`  batch failed (will retry next run): ${msg}`);
      return;
    }
    const ids = new Set(batch.map((r) => r.id));
    tx(db, () => {
      for (const item of parsed.items ?? []) {
        if (!ids.has(item.id)) continue;
        for (const c of item.companies ?? []) {
          const name = c.name?.trim();
          if (!name || name.length > 80) continue;
          const context = CONTEXTS.includes(c.context as (typeof CONTEXTS)[number]) ? c.context! : "neutral";
          const res = insert.run(item.id, name, c.domain?.trim() || null, context, c.evidence?.slice(0, 300) ?? null);
          mentions += Number(res.changes);
        }
      }
      const t = now();
      for (const id of ids) done.run(t, id);
    });
    finished++;
    if (finished % 50 === 0 || finished === batches.length) log(`  extract: ${finished}/${batches.length} batches, ${mentions} mentions`);
  });
  if (fatal) throw new Error(`Extraction stopped: ${fatal}`);
  return { items: rows.length, mentions, failedBatches, blockedItems };
}
